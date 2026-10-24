import { v4 as uuidv4 } from 'uuid';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/shared/value-objects/money.js';
import { FailureCode } from '../../domain/shared/value-objects/failure-code.js';
import { WagerTransaction } from '../../domain/wagering/entities/wager-transaction.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wagering/entities/wager-transaction.enums.js';
import { LedgerDirection } from '../../domain/wallet/entities/ledger-direction.enum.js';
import { OutboxMessage } from '../../domain/shared/events/outbox-message.js';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from '../../domain/shared/events/domain-events.js';
import {
  InsufficientFundsError,
  IdempotencyKeyReuseWithDifferentPayloadError,
  ReferenceAlreadyRevertedError,
  ReversalWouldResultInNegativeBalanceError,
  WalletNotFoundError,
} from '../../shared/errors/domain.errors.js';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../infrastructure/database/repositories/outbox-message.repository.js';
import { generateCanonicalPayloadHash } from '../../shared/utils/canonical-hash.js';

export interface ProcessWagerTransactionInput {
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: { amount: string; currency: string };
  readonly referenceExternalTransactionId?: string;
  readonly correlationId: string;
  /** Set when message arrives from SQS — messageId for inbox deduplication */
  readonly inboxMessageId?: string;
  readonly consumerName?: string;
}

export interface ProcessWagerTransactionOutput {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: { amount: string; currency: string };
  readonly idempotentReplay: boolean;
}

/**
 * ProcessWagerTransaction — Core use case.
 *
 * Atomicity guarantee (single SQL transaction):
 *   1. SELECT wallet FOR UPDATE (pessimistic lock)
 *   2. Check idempotency (read wager_transactions by idempotency_key)
 *   3. Apply balance mutation (debit/credit)
 *   4. INSERT wallet_ledger_entry (immutable)
 *   5. INSERT/UPDATE wager_transaction
 *   6. INSERT outbox_message (event queued for async publish)
 *   7. COMMIT
 *
 * SQS ack happens AFTER commit — never before.
 */
export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly txRepo: WagerTransactionRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
    private readonly outboxRepo: OutboxMessageRepository,
  ) {}

  async execute(input: ProcessWagerTransactionInput): Promise<ProcessWagerTransactionOutput> {
    return this.em.transactional(async (em) => {
      // Scoped repositories operating on the same transaction's EntityManager
      const walletRepo = new WalletRepository(em);
      const txRepo = new WagerTransactionRepository(em);
      const ledgerRepo = new WalletLedgerEntryRepository(em);
      const outboxRepo = new OutboxMessageRepository(em);

      // ------------------------------------------------------------------
      // 1. Lock wallet pessimistically
      // ------------------------------------------------------------------
      const wallet = await walletRepo.findByIdForUpdate(input.walletId);
      if (!wallet) throw new WalletNotFoundError(input.walletId);

      // ------------------------------------------------------------------
      // 2. Idempotency check
      // ------------------------------------------------------------------
      const existing = await txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        const payloadHash = generateCanonicalPayloadHash(this.buildHashablePayload(input));
        if (!existing.matchesPayload(payloadHash)) {
          throw new IdempotencyKeyReuseWithDifferentPayloadError(input.idempotencyKey);
        }
        // Idempotent replay — return stored result
        return {
          transactionId: existing.id,
          status: existing.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: true,
        };
      }

      const payloadHash = generateCanonicalPayloadHash(this.buildHashablePayload(input));
      const money = Money.from(input.money);
      const now = new Date();
      const transactionId = uuidv4();

      // ------------------------------------------------------------------
      // 3. Create domain transaction entity
      // ------------------------------------------------------------------
      const transaction = WagerTransaction.create({
        id: transactionId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
        createdAt: now,
      });

      // ------------------------------------------------------------------
      // 4. Process by kind
      // ------------------------------------------------------------------
      let ledgerEntry: ReturnType<typeof wallet.debit>['entry'] | undefined;
      let referenceTransactionId: string | undefined;

      try {
        switch (input.kind) {
          case WagerTransactionKind.Bet: {
            const result = wallet.debit(transactionId, money, now);
            ledgerEntry = result.entry;
            transaction.markProcessed(undefined, now);
            break;
          }

          case WagerTransactionKind.Win: {
            const result = wallet.credit(transactionId, money, now);
            ledgerEntry = result.entry;
            transaction.markProcessed(undefined, now);
            break;
          }

          case WagerTransactionKind.Loss: {
            // No balance effect, no ledger entry
            transaction.markProcessed(undefined, now);
            break;
          }

          case WagerTransactionKind.Refund:
          case WagerTransactionKind.Rollback: {
            const refResult = await this.resolveReference(
              txRepo,
              input.providerId,
              input.referenceExternalTransactionId!,
              input.kind,
              money,
            );

            if (refResult.pendingReference) {
              transaction.markPendingReference();
              await txRepo.save(transaction, input.walletId);
              // Enqueue pending reference event
              const event = new WagerTransactionPendingReference({
                eventId: uuidv4(),
                aggregateId: transactionId,
                correlationId: input.correlationId,
                occurredAt: now,
                data: {
                  transactionId,
                  walletId: input.walletId,
                  providerId: input.providerId,
                  externalTransactionId: input.externalTransactionId,
                  referenceExternalTransactionId: input.referenceExternalTransactionId!,
                  kind: input.kind,
                },
              });
              await outboxRepo.save(OutboxMessage.enqueue(event as any));
              await em.flush();

              return {
                transactionId,
                status: WagerTransactionStatus.PendingReference,
                balance: wallet.balance.toJSON(),
                idempotentReplay: false,
              };
            }

            referenceTransactionId = refResult.referenceId;
            const refDirection = refResult.direction;

            if (refDirection === LedgerDirection.Debit) {
              // Reference was a DEBIT (BET) — reversal is a CREDIT
              const result = wallet.credit(transactionId, money, now);
              ledgerEntry = result.entry;
            } else {
              // Reference was a CREDIT (WIN/REFUND) — reversal is a DEBIT
              const result = wallet.debit(transactionId, money, now);
              ledgerEntry = result.entry;
            }
            transaction.markProcessed(referenceTransactionId, now);
            break;
          }
        }
      } catch (err) {
        if (
          err instanceof InsufficientFundsError ||
          err instanceof ReferenceAlreadyRevertedError ||
          err instanceof ReversalWouldResultInNegativeBalanceError
        ) {
          const code = this.toFailureCode(err);
          transaction.reject(code);
          await txRepo.save(transaction, input.walletId);

          const rejectedEvent = new WagerTransactionRejected({
            eventId: uuidv4(),
            aggregateId: transactionId,
            correlationId: input.correlationId,
            occurredAt: now,
            data: {
              transactionId,
              walletId: input.walletId,
              playerId: input.playerId,
              providerId: input.providerId,
              externalTransactionId: input.externalTransactionId,
              kind: input.kind,
              failureCode: code,
              money: money.toJSON(),
            },
          });
          await outboxRepo.save(OutboxMessage.enqueue(rejectedEvent as any));
          await em.flush();

          return {
            transactionId,
            status: WagerTransactionStatus.Rejected,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
        throw err;
      }

      // ------------------------------------------------------------------
      // 5. Persist wallet (updated balance + version)
      // ------------------------------------------------------------------
      await walletRepo.save(wallet);

      // 6. Persist ledger entry (if any)
      if (ledgerEntry) {
        await ledgerRepo.save(ledgerEntry, input.walletId);
      }

      // 7. Persist wager transaction
      await txRepo.save(transaction, input.walletId);

      // 8. Enqueue integration events
      const processedEvent = new WagerTransactionProcessed({
        eventId: uuidv4(),
        aggregateId: transactionId,
        correlationId: input.correlationId,
        occurredAt: now,
        data: {
          transactionId,
          walletId: input.walletId,
          playerId: input.playerId,
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
          kind: input.kind,
          status: WagerTransactionStatus.Processed,
          money: money.toJSON(),
          idempotentReplay: false,
        },
      });
      await outboxRepo.save(OutboxMessage.enqueue(processedEvent as any));

      if (ledgerEntry) {
        const balanceEvent = WalletBalanceChanged.from(
          input.walletId,
          transactionId,
          ledgerEntry.direction,
          ledgerEntry.money.toJSON(),
          ledgerEntry.balanceBefore.toJSON(),
          ledgerEntry.balanceAfter.toJSON(),
          wallet.version,
          input.correlationId,
        );
        await outboxRepo.save(OutboxMessage.enqueue(balanceEvent as any));
      }

      // ------------------------------------------------------------------
      // 9. COMMIT (flush all pending inserts/updates in one transaction)
      // ------------------------------------------------------------------
      await em.flush();

      return {
        transactionId,
        status: WagerTransactionStatus.Processed,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private buildHashablePayload(input: ProcessWagerTransactionInput): Record<string, unknown> {
    return {
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      ...(input.referenceExternalTransactionId
        ? { referenceExternalTransactionId: input.referenceExternalTransactionId }
        : {}),
    };
  }

  private async resolveReference(
    txRepo: WagerTransactionRepository,
    providerId: string,
    referenceExternalTransactionId: string,
    kind: WagerTransactionKind,
    money: Money,
  ): Promise<{ pendingReference: false; referenceId: string; direction: LedgerDirection } | { pendingReference: true }> {
    const ref = await txRepo.findByProviderAndExternalId(providerId, referenceExternalTransactionId);

    if (!ref) {
      return { pendingReference: true };
    }

    if (ref.status !== WagerTransactionStatus.Processed) {
      return { pendingReference: true };
    }

    // Validate kind compatibility
    if (kind === WagerTransactionKind.Refund && ref.kind !== WagerTransactionKind.Bet) {
      throw new ReferenceAlreadyRevertedError(referenceExternalTransactionId);
    }

    if (
      kind === WagerTransactionKind.Rollback &&
      ![WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund].includes(ref.kind)
    ) {
      throw new ReferenceAlreadyRevertedError(referenceExternalTransactionId);
    }

    // Check not already reverted
    const direction = ref.ledgerDirectionFor();
    return { pendingReference: false, referenceId: ref.id, direction };
  }

  private toFailureCode(err: unknown): FailureCode {
    if (err instanceof InsufficientFundsError) return FailureCode.InsufficientFunds;
    if (err instanceof ReferenceAlreadyRevertedError) return FailureCode.ReferenceAlreadyReverted;
    if (err instanceof ReversalWouldResultInNegativeBalanceError)
      return FailureCode.ReversalWouldResultInNegativeBalance;
    return FailureCode.TransientInfraError;
  }
}
