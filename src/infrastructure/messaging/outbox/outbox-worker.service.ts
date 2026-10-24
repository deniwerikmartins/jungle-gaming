import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import { sqsClient } from '../sqs/sqs-client.provider.js';
import { OutboxMessageOrmEntity } from '../../database/entities/outbox-message.orm-entity.js';
import { metrics } from '../../../shared/utils/metrics.js';

const BATCH_SIZE = 10;

/**
 * OutboxWorkerService — Transactional Outbox publisher.
 * SELECT FOR UPDATE SKIP LOCKED must run inside a transaction.
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private shuttingDown = false;

  private readonly queueUrl =
    process.env['SQS_EVENTS_URL'] ??
    process.env['SQS_QUEUE_URL'] ??
    'http://localstack:4566/000000000000/wager-transactions.fifo';

  constructor(private readonly em: EntityManager) {}

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    this.logger.log('Outbox worker shutting down');
  }

  @Cron('*/2 * * * * *') // every 2 seconds
  async processBatch(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      const fork = this.em.fork();

      // SKIP LOCKED requires an explicit transaction
      await fork.transactional(async (tx) => {
        const orms = await tx.getConnection().execute<{
          id: string;
          aggregate_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          occurred_at: Date;
          attempts: number;
        }[]>(
          `SELECT id, aggregate_id, event_type, payload, occurred_at, attempts
           FROM outbox_messages
           WHERE published_at IS NULL
             AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
           ORDER BY occurred_at ASC
           LIMIT ?
           FOR UPDATE SKIP LOCKED`,
          [BATCH_SIZE],
        );

        if (orms.length === 0) return;

        this.logger.debug(`Processing ${orms.length} outbox message(s)`);

        for (const orm of orms) {
          if (this.shuttingDown) break;
          await this.publishOne(tx, orm);
        }
      });
    } catch (err) {
      if (!String(err).includes('could not obtain lock') && !String(err).includes('SKIP LOCKED')) {
        this.logger.error(`Outbox batch error: ${String(err)}`);
      }
    }
  }

  private async publishOne(
    tx: EntityManager,
    orm: { id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; attempts: number },
  ): Promise<void> {
    const now = new Date();

    try {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(orm.payload),
          MessageGroupId: orm.aggregate_id,
          MessageDeduplicationId: orm.id,
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: orm.event_type },
          },
        }),
      );

      await tx.getConnection().execute(
        `UPDATE outbox_messages SET published_at = ? WHERE id = ? AND published_at IS NULL`,
        [now, orm.id],
      );

      metrics.outbox.published++;

      this.logger.debug(
        JSON.stringify({ msg: 'Outbox message published', id: orm.id, eventType: orm.event_type }),
      );
    } catch (err) {
      this.logger.warn(
        JSON.stringify({ msg: 'Outbox publish failed, scheduling retry', id: orm.id, err: String(err) }),
      );

      const backoffMs = Math.min(Math.pow(2, orm.attempts + 1) * 1000, 8 * 60 * 1000);
      const nextAttempt = new Date(now.getTime() + backoffMs);

      await tx.getConnection().execute(
        `UPDATE outbox_messages SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?`,
        [nextAttempt, orm.id],
      );

      metrics.outbox.retries++;
    }
  }
}
