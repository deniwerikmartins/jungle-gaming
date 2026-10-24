/**
 * Concurrency integration test — 50 parallel BETs on the same wallet.
 *
 * This is the mandatory scenario from the spec:
 * - Wallet with 100.00 BRL
 * - 50 simultaneous BET requests of 80.00 BRL
 * - Expected: exactly 1 PROCESSED, 49 REJECTED, final balance 20.00 BRL,
 *             exactly 1 ledger DEBIT entry
 *
 * Requires: PostgreSQL running with real SERIALIZABLE / FOR UPDATE support.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { getTestEm, cleanDatabase, closeTestOrm, getTestOrm } from './helpers/db.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case.js';
import { ReconcileWalletUseCase } from '../../src/application/wallet/reconcile-wallet.use-case.js';
import { WalletRepository } from '../../src/infrastructure/database/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../src/infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../src/infrastructure/database/repositories/outbox-message.repository.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wagering/entities/wager-transaction.enums.js';
import { v4 as uuidv4 } from 'uuid';

let em: Awaited<ReturnType<typeof getTestEm>>;

beforeAll(async () => {
  em = await getTestEm();
});

beforeEach(async () => {
  await cleanDatabase(em);
});

afterAll(async () => {
  await closeTestOrm();
});

describe('Concurrency — 50 parallel BETs on hot wallet', () => {
  it('exactly 1 PROCESSED, 49 REJECTED, balance 20.00, 1 ledger debit', async () => {
    const N = 50;
    const BET_AMOUNT = '80.00';
    const INITIAL_BALANCE = '100.00';

    // Create wallet
    const createUc = new CreateWalletUseCase(em);
    const wallet = await createUc.execute({
      playerId: uuidv4(),
      initialBalance: { amount: INITIAL_BALANCE, currency: 'BRL' },
      correlationId: 'test-concurrency',
    });

    // Get a fresh ORM reference for forking per request
    const testOrm = await getTestOrm();

    // Fire 50 concurrent requests — each with its own EntityManager fork
    const requests = Array.from({ length: N }, (_, i) => {
      const extId = `concurrent-bet-${i}-${uuidv4()}`;
      const forkEm = testOrm.em.fork();

      return new ProcessWagerTransactionUseCase(
        forkEm,
        new WalletRepository(forkEm),
        new WagerTransactionRepository(forkEm),
        new WalletLedgerEntryRepository(forkEm),
        new OutboxMessageRepository(forkEm),
      ).execute({
        idempotencyKey: `provider-a:${extId}`,
        providerId: 'provider-a',
        externalTransactionId: extId,
        playerId: uuidv4(),
        walletId: wallet.id,
        roundId: 'round-concurrency',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: { amount: BET_AMOUNT, currency: 'BRL' },
        correlationId: `corr-${i}`,
      });
    });

    // Run all 50 in parallel
    const results = await Promise.allSettled(requests);

    const processed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === WagerTransactionStatus.Processed,
    );
    const rejected = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === WagerTransactionStatus.Rejected,
    );
    const errors = results.filter((r) => r.status === 'rejected');

    console.log(`Processed: ${processed.length}, Rejected: ${rejected.length}, Errors: ${errors.length}`);

    // Core invariant: exactly 1 processed, rest rejected
    expect(processed.length).toBe(1);
    expect(rejected.length).toBe(N - 1);
    expect(errors.length).toBe(0);

    // Final balance must be exactly 20.00
    const finalBalance = (processed[0] as PromiseFulfilledResult<any>).value.balance.amount;
    expect(finalBalance).toBe('20.00');

    // Verify via DB — use a fresh fork to avoid stale cache
    const verifyEm = (await getTestOrm()).em.fork();
    const ledgerEntries = await verifyEm.getConnection().execute<{ direction: string; count: string }[]>(
      `SELECT direction, COUNT(*) as count
       FROM wallet_ledger_entries
       WHERE wallet_id = ?
       GROUP BY direction`,
      [wallet.id],
    );

    const debitEntry = ledgerEntries.find((e) => e.direction === 'DEBIT');
    const creditEntry = ledgerEntries.find((e) => e.direction === 'CREDIT');

    expect(Number(debitEntry?.count ?? 0)).toBe(1);   // exactly 1 debit
    expect(Number(creditEntry?.count ?? 0)).toBe(1);  // 1 credit (OPENING)

    // Reconciliation must confirm consistency — fresh fork to bypass Identity Map cache
    const reconcileUc = new ReconcileWalletUseCase(verifyEm);
    const reconcile = await reconcileUc.execute(wallet.id);
    expect(reconcile.consistent).toBe(true);
    expect(reconcile.storedBalance.amount).toBe('20.00');
    expect(reconcile.calculatedBalance.amount).toBe('20.00');
  }, 60_000); // 60s timeout for concurrent test
});
