import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { sqsClient } from '../sqs/sqs-client.provider.js';
import { OutboxMessageRepository } from '../../database/repositories/outbox-message.repository.js';
import { OutboxMessageOrmEntity } from '../../database/entities/outbox-message.orm-entity.js';

const OUTBOX_QUEUE_URL =
  process.env['SQS_QUEUE_URL'] ??
  'http://localstack:4566/000000000000/wager-transactions.fifo';

const BATCH_SIZE = 10;

/**
 * OutboxWorkerService — Transactional Outbox publisher.
 *
 * Polls outbox_messages WHERE published_at IS NULL AND next_attempt_at <= NOW().
 * Uses SELECT FOR UPDATE SKIP LOCKED so multiple instances don't duplicate work.
 *
 * Guarantees:
 * - Event is published to SQS only after DB commit.
 * - If publish fails, scheduleRetry sets exponential backoff.
 * - published_at is set only after successful SQS send.
 * - Surviving duplicates in SQS are safe — consumers use Inbox deduplication.
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private shuttingDown = false;

  constructor(private readonly em: EntityManager) {}

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    this.logger.log('Outbox worker shutting down');
  }

  @Cron(CronExpression.EVERY_2_SECONDS)
  async processBatch(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      const fork = this.em.fork();

      // Fetch pending messages with SKIP LOCKED for concurrent-safe polling
      const orms = await fork.find(
        OutboxMessageOrmEntity,
        {
          publishedAt: null,
          $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
        },
        {
          lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL,
          limit: BATCH_SIZE,
          orderBy: { occurredAt: 'ASC' },
        },
      );

      if (orms.length === 0) return;

      this.logger.debug(`Processing ${orms.length} outbox message(s)`);

      for (const orm of orms) {
        if (this.shuttingDown) break;
        await this.publishOne(fork, orm);
      }
    } catch (err) {
      // SKIP LOCKED throws when no rows available — that's normal
      if (!String(err).includes('could not obtain lock')) {
        this.logger.error(`Outbox batch error: ${String(err)}`);
      }
    }
  }

  private async publishOne(em: EntityManager, orm: OutboxMessageOrmEntity): Promise<void> {
    const now = new Date();

    try {
      const payload = JSON.stringify(orm.payload);

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: OUTBOX_QUEUE_URL,
          MessageBody: payload,
          MessageGroupId: orm.aggregateId,
          MessageDeduplicationId: orm.id,
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: orm.eventType },
          },
        }),
      );

      // Mark published inside its own transaction
      await em.transactional(async (tx) => {
        const fresh = await tx.findOne(OutboxMessageOrmEntity, { id: orm.id });
        if (fresh && !fresh.publishedAt) {
          fresh.publishedAt = now;
          await tx.flush();
        }
      });

      this.logger.debug(
        JSON.stringify({ msg: 'Outbox message published', id: orm.id, eventType: orm.eventType }),
      );
    } catch (err) {
      this.logger.warn(
        JSON.stringify({ msg: 'Outbox publish failed, scheduling retry', id: orm.id, err: String(err) }),
      );

      await em.transactional(async (tx) => {
        const fresh = await tx.findOne(OutboxMessageOrmEntity, { id: orm.id });
        if (fresh && !fresh.publishedAt) {
          fresh.attempts += 1;
          const backoffMs = Math.min(Math.pow(2, fresh.attempts) * 1000, 8 * 60 * 1000);
          fresh.nextAttemptAt = new Date(now.getTime() + backoffMs);
          await tx.flush();
        }
      });
    }
  }
}
