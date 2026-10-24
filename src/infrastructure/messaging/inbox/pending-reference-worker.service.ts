import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/postgresql';
import { v4 as uuidv4 } from 'uuid';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case.js';
import { WalletRepository } from '../../database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../database/repositories/outbox-message.repository.js';
import { OutboxMessage } from '../../../domain/shared/events/outbox-message.js';
import { WagerTransactionRejected } from '../../../domain/shared/events/domain-events.js';
import { FailureCode } from '../../../domain/shared/value-objects/failure-code.js';
import { WagerTransactionStatus } from '../../../domain/wagering/entities/wager-transaction.enums.js';
import { WagerTransactionOrmEntity } from '../../database/entities/wager-transaction.orm-entity.js';
import { WagerTransactionMapper } from '../../database/entities/wager-transaction.mapper.js';

const MAX_RETRIES = Number(process.env['PENDING_REFERENCE_MAX_RETRIES'] ?? 5);

/**
 * PendingReferenceWorkerService — Retries PENDING_REFERENCE transactions.
 *
 * Runs every 30 seconds, picks up to 50 PENDING_REFERENCE transactions and
 * attempts to resolve them using the core use case.
 *
 * After MAX_RETRIES attempts: transitions to REJECTED with
 * FailureCode.PendingReferenceMaxRetriesExceeded and publishes the event.
 */
@Injectable()
export class PendingReferenceWorkerService {
  private readonly logger = new Logger(PendingReferenceWorkerService.name);

  constructor(private readonly em: EntityManager) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async retryPendingReferences(): Promise<void> {
    try {
      const fork = this.em.fork();
      const txRepo = new WagerTransactionRepository(fork);
      const pending = await txRepo.findPendingReference(50);

      if (pending.length === 0) return;

      this.logger.log(`Retrying ${pending.length} PENDING_REFERENCE transaction(s)`);

      for (const tx of pending) {
        await this.retryOne(tx.id);
      }
    } catch (err) {
      this.logger.error(`PendingReferenceWorker error: ${String(err)}`);
    }
  }

  private async retryOne(transactionId: string): Promise<void> {
    const fork = this.em.fork();

    await fork.transactional(async (em) => {
      const orm = await em.findOne(
        WagerTransactionOrmEntity,
        { id: transactionId },
        { populate: ['wallet'] },
      );

      if (!orm) return;

      const tx = WagerTransactionMapper.toDomain(orm);

      // Count previous attempts via a retry counter stored in failureCode metadata
      // We use the processedAt absence as a proxy — track attempt count via DB query
      const attemptCount = await em
        .getConnection()
        .execute<{ count: string }[]>(
          `SELECT COUNT(*) AS count FROM outbox_messages
           WHERE aggregate_id = ? AND event_type = 'WagerTransactionPendingReference'`,
          [transactionId],
        )
        .then((r) => Number(r[0]?.count ?? 0));

      if (attemptCount >= MAX_RETRIES) {
        // Exhaust retries → REJECTED
        this.logger.warn(
          `Transaction ${transactionId} exhausted ${MAX_RETRIES} retries → REJECTED`,
        );
        tx.reject(FailureCode.PendingReferenceMaxRetriesExceeded);
        orm.status = tx.status;
        orm.failureCode = tx.failureCode;
        orm.processedAt = new Date();

        const rejectedEvent = new WagerTransactionRejected({
          eventId: uuidv4(),
          aggregateId: transactionId,
          correlationId: transactionId,
          occurredAt: new Date(),
          data: {
            transactionId,
            walletId: orm.wallet.id,
            playerId: orm.playerId,
            providerId: orm.providerId,
            externalTransactionId: orm.externalTransactionId,
            kind: orm.kind,
            failureCode: FailureCode.PendingReferenceMaxRetriesExceeded,
            money: { amount: orm.moneyAmount, currency: orm.moneyCurrency },
          },
        });

        const outboxRepo = new OutboxMessageRepository(em);
        await outboxRepo.save(OutboxMessage.enqueue(rejectedEvent as any));
        await em.flush();
        return;
      }

      // Re-attempt via use case
      try {
        const useCase = new ProcessWagerTransactionUseCase(
          em,
          new WalletRepository(em),
          new WagerTransactionRepository(em),
          new WalletLedgerEntryRepository(em),
          new OutboxMessageRepository(em),
        );

        await useCase.execute({
          idempotencyKey: tx.idempotencyKey,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          playerId: tx.playerId,
          walletId: orm.wallet.id,
          roundId: tx.roundId,
          gameId: tx.gameId,
          kind: tx.kind,
          money: tx.money.toJSON(),
          referenceExternalTransactionId: tx.referenceExternalTransactionId,
          correlationId: tx.idempotencyKey,
        });

        this.logger.log(`PENDING_REFERENCE ${transactionId} resolved successfully`);
      } catch (err) {
        this.logger.warn(
          `PENDING_REFERENCE ${transactionId} retry failed: ${String(err)}`,
        );
      }
    });
  }
}
