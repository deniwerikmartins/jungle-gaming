import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import { sqsClient } from './sqs-client.provider.js';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case.js';
import { WalletRepository } from '../../database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../database/repositories/outbox-message.repository.js';
import { InboxMessageRepository } from '../../database/repositories/inbox-message.repository.js';
import { InboxMessage } from '../../../domain/shared/events/inbox-message.js';
import { WagerTransactionKind } from '../../../domain/wagering/entities/wager-transaction.enums.js';
import { generateCanonicalPayloadHash } from '../../../shared/utils/canonical-hash.js';
import { DomainError } from '../../../shared/errors/domain.errors.js';
import { v4 as uuidv4 } from 'uuid';

const CONSUMER_NAME = 'wager-sqs-consumer';
const VISIBILITY_TIMEOUT_S = 30;
const SHUTDOWN_TIMEOUT_MS = Number(process.env['GRACEFUL_SHUTDOWN_TIMEOUT_MS'] ?? 30_000);

interface SqsMessageBody {
  messageId: string;
  type: string;
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}

/**
 * SqsConsumerService — Long-polling SQS consumer.
 *
 * Lifecycle per message:
 *   1. Parse & validate body
 *   2. BEGIN transaction
 *   3. Check Inbox for duplicate (consumerName, messageId)
 *   4. Execute ProcessWagerTransaction use case (same em/transaction)
 *   5. Mark InboxMessage as processed
 *   6. COMMIT
 *   7. ACK (DeleteMessage) — ONLY after commit
 *
 * On SIGTERM: stops polling, resets visibility on in-flight message so
 * another instance can pick it up without delay.
 */
@Injectable()
export class SqsConsumerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumerService.name);
  private running = false;
  private shuttingDown = false;
  private inFlightReceiptHandle: string | null = null;

  private readonly queueUrl =
    process.env['SQS_QUEUE_URL'] ??
    'http://localstack:4566/000000000000/wager-transactions.fifo';

  constructor(private readonly em: EntityManager) {}

  startPolling(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log('SQS consumer started');
    void this.pollLoop();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutdown signal received (${signal}), stopping SQS consumer...`);
    this.shuttingDown = true;
    this.running = false;

    // If a message is in-flight, reset its visibility so another instance handles it
    if (this.inFlightReceiptHandle) {
      try {
        await sqsClient.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: this.inFlightReceiptHandle,
            VisibilityTimeout: 0,
          }),
        );
        this.logger.log('In-flight message visibility reset for graceful handoff');
      } catch (err) {
        this.logger.warn(`Failed to reset visibility: ${String(err)}`);
      }
    }

    // Allow up to SHUTDOWN_TIMEOUT_MS for current processing to finish
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (this.inFlightReceiptHandle && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running && !this.shuttingDown) {
      try {
        const result = await sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: Number(process.env['SQS_MAX_MESSAGES'] ?? 10),
            WaitTimeSeconds: Number(process.env['SQS_POLL_WAIT_SECONDS'] ?? 20),
            AttributeNames: ['All'],
            MessageAttributeNames: ['All'],
          }),
        );

        const messages = result.Messages ?? [];
        for (const msg of messages) {
          if (this.shuttingDown) break;
          await this.processMessage(msg);
        }
      } catch (err) {
        if (!this.shuttingDown) {
          this.logger.error(`SQS poll error: ${String(err)}`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    this.logger.log('SQS consumer poll loop exited');
  }

  private async processMessage(msg: {
    MessageId?: string;
    ReceiptHandle?: string;
    Body?: string;
  }): Promise<void> {
    const receiptHandle = msg.ReceiptHandle!;
    this.inFlightReceiptHandle = receiptHandle;

    try {
      const body: SqsMessageBody = JSON.parse(msg.Body ?? '{}');
      const messageId = body.messageId ?? msg.MessageId ?? uuidv4();

      // Fork a new EntityManager for this message (isolated unit of work)
      const fork = this.em.fork();

      await fork.transactional(async (em) => {
        const inboxRepo = new InboxMessageRepository(em);

        // ------------------------------------------------------------------
        // Inbox deduplication — if already processed, just ack
        // ------------------------------------------------------------------
        const existingInbox = await inboxRepo.findByKey(CONSUMER_NAME, messageId);
        if (existingInbox?.isProcessed()) {
          this.logger.debug(`Duplicate SQS message ${messageId} — already processed, acking`);
          return;
        }

        const payloadHash = generateCanonicalPayloadHash(body.data as Record<string, unknown>);

        // Create inbox record (INSERT will conflict/throw if duplicate)
        const inbox = InboxMessage.receive({
          messageId,
          consumerName: CONSUMER_NAME,
          payloadHash,
          receivedAt: new Date(),
        });

        await inboxRepo.save(inbox);

        // ------------------------------------------------------------------
        // Execute core use case inside the same transaction
        // ------------------------------------------------------------------
        const useCase = new ProcessWagerTransactionUseCase(
          em,
          new WalletRepository(em),
          new WagerTransactionRepository(em),
          new WalletLedgerEntryRepository(em),
          new OutboxMessageRepository(em),
        );

        await useCase.execute({
          idempotencyKey: body.data.idempotencyKey,
          providerId: body.data.providerId,
          externalTransactionId: body.data.externalTransactionId,
          playerId: body.data.playerId,
          walletId: body.data.walletId,
          roundId: body.data.roundId,
          gameId: body.data.gameId,
          kind: body.data.kind as WagerTransactionKind,
          money: body.data.money,
          referenceExternalTransactionId: body.data.referenceExternalTransactionId,
          correlationId: messageId,
          inboxMessageId: messageId,
          consumerName: CONSUMER_NAME,
        });

        // Mark inbox as processed (same transaction)
        inbox.markProcessed(new Date());
        await em.flush();
      });

      // ------------------------------------------------------------------
      // ACK — ONLY after successful commit
      // ------------------------------------------------------------------
      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );

      this.logger.log(
        JSON.stringify({ msg: 'SQS message processed', messageId: msg.MessageId }),
      );
    } catch (err) {
      // Distinguish terminal business errors from transient infra errors.
      //
      // TERMINAL (ack immediately): domain errors mean the message payload is
      // permanently invalid — retrying will always fail the same way, and
      // letting it hit the DLQ wastes retries and fills the dead-letter queue
      // with expected failures.
      //
      // TRANSIENT (leave in queue): infrastructure errors (DB timeout, network
      // failure) are recoverable — SQS will retry after VisibilityTimeout, and
      // eventually route to DLQ after maxReceiveCount.
      const isTerminalError = err instanceof DomainError;

      if (isTerminalError) {
        this.logger.warn(
          JSON.stringify({
            msg: 'SQS message failed with terminal business error — acking to avoid DLQ',
            messageId: msg.MessageId,
            err: String(err),
            code: (err as any).code,
          }),
        );
        // ACK terminal errors — no point retrying a permanently invalid message
        try {
          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: receiptHandle,
            }),
          );
        } catch (ackErr) {
          this.logger.warn(`Failed to ack terminal error message: ${String(ackErr)}`);
        }
      } else {
        // Transient error — leave in queue for SQS retry / DLQ
        this.logger.error(
          JSON.stringify({ msg: 'SQS message processing failed (transient)', err: String(err) }),
        );
      }
      }
    } finally {
      this.inFlightReceiptHandle = null;
    }
  }
}
