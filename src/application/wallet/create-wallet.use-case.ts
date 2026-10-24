import { v4 as uuidv4 } from 'uuid';
import { EntityManager } from '@mikro-orm/postgresql';
import { Wallet } from '../../domain/wallet/entities/wallet.js';
import { Money } from '../../domain/shared/value-objects/money.js';
import { WagerTransaction } from '../../domain/wagering/entities/wager-transaction.js';
import { OutboxMessage } from '../../domain/shared/events/outbox-message.js';
import { WalletBalanceChanged } from '../../domain/shared/events/domain-events.js';
import { LedgerDirection } from '../../domain/wallet/entities/ledger-direction.enum.js';
import { WalletAlreadyExistsError } from '../../shared/errors/domain.errors.js';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../infrastructure/database/repositories/outbox-message.repository.js';
import { generateCanonicalPayloadHash } from '../../shared/utils/canonical-hash.js';

export interface CreateWalletInput {
  readonly playerId: string;
  readonly initialBalance: { amount: string; currency: string };
  readonly correlationId: string;
}

export interface CreateWalletOutput {
  readonly id: string;
  readonly playerId: string;
  readonly balance: { amount: string; currency: string };
  readonly version: number;
}

export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    return this.em.transactional(async (em) => {
      const walletRepo = new WalletRepository(em);
      const txRepo = new WagerTransactionRepository(em);
      const ledgerRepo = new WalletLedgerEntryRepository(em);
      const outboxRepo = new OutboxMessageRepository(em);

      const initialBalance = Money.from(input.initialBalance);

      // ------------------------------------------------------------------
      // Check uniqueness (player + currency)
      // ------------------------------------------------------------------
      const existing = await walletRepo.findByPlayerAndCurrency(
        input.playerId,
        initialBalance.currency,
      );
      if (existing) {
        throw new WalletAlreadyExistsError(input.playerId, initialBalance.currency);
      }

      const walletId = uuidv4();
      const now = new Date();

      // ------------------------------------------------------------------
      // Open wallet with zero balance first, then credit initial balance
      // so the ledger entry is properly recorded
      // ------------------------------------------------------------------
      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        initialBalance: Money.zero(initialBalance.currency),
      });

      await walletRepo.save(wallet);

      // ------------------------------------------------------------------
      // If initial balance > 0, create OPENING transaction + ledger entry
      // in the same transaction
      // ------------------------------------------------------------------
      if (initialBalance.isPositive()) {
        const openingTxId = uuidv4();
        const payloadHash = generateCanonicalPayloadHash({
          walletId,
          playerId: input.playerId,
          kind: 'OPENING',
          money: input.initialBalance,
        });

        const openingTx = WagerTransaction.createOpening({
          id: openingTxId,
          providerId: 'system',
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `system:opening-${walletId}`,
          payloadHash,
          walletId,
          playerId: input.playerId,
          roundId: 'N/A',
          gameId: 'N/A',
          money: initialBalance,
          createdAt: now,
        });

        const { entry } = wallet.credit(openingTxId, initialBalance, now);
        openingTx.markProcessed(undefined, now);

        await walletRepo.save(wallet);
        await txRepo.save(openingTx, walletId);
        await ledgerRepo.save(entry, walletId);

        // Enqueue WalletBalanceChanged event
        const event = WalletBalanceChanged.from(
          walletId,
          openingTxId,
          LedgerDirection.Credit,
          entry.money.toJSON(),
          entry.balanceBefore.toJSON(),
          entry.balanceAfter.toJSON(),
          wallet.version,
          input.correlationId,
        );
        await outboxRepo.save(OutboxMessage.enqueue(event as any));
      }

      await em.flush();

      return {
        id: walletId,
        playerId: input.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
