/**
 * Integration tests — Wagering transactions: BET, WIN, LOSS, REFUND, ROLLBACK,
 * idempotency, PENDING_REFERENCE and atomicity.
 * Requires: PostgreSQL running (docker compose up postgres)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { getTestEm, cleanDatabase, closeTestOrm } from './helpers/db.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case.js';
import { GetWalletUseCase } from '../../src/application/wallet/get-wallet.use-case.js';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createWallet(balance = '1000.00') {
  const uc = new CreateWalletUseCase(em);
  return uc.execute({
    playerId: uuidv4(),
    initialBalance: { amount: balance, currency: 'BRL' },
    correlationId: uuidv4(),
  });
}

function makeWagerUseCase() {
  return new ProcessWagerTransactionUseCase(
    em,
    new WalletRepository(em),
    new WagerTransactionRepository(em),
    new WalletLedgerEntryRepository(em),
    new OutboxMessageRepository(em),
  );
}

async function submitBet(walletId: string, amount: string, extId?: string) {
  const externalId = extId ?? uuidv4();
  const result = await makeWagerUseCase().execute({
    idempotencyKey: `provider-a:${externalId}`,
    providerId: 'provider-a',
    externalTransactionId: externalId,
    playerId: uuidv4(),
    walletId,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount, currency: 'BRL' },
    correlationId: uuidv4(),
  });
  return { ...result, externalId };
}

// ---------------------------------------------------------------------------
// BET
// ---------------------------------------------------------------------------
describe('BET integration', () => {
  it('debits wallet and returns PROCESSED', async () => {
    const wallet = await createWallet('100.00');
    const result = await submitBet(wallet.id, '25.00');

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('75.00');
    expect(result.idempotentReplay).toBe(false);
  });

  it('rejects BET when balance is insufficient (REJECTED + 422 logic)', async () => {
    const wallet = await createWallet('10.00');
    const result = await submitBet(wallet.id, '50.00');

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.balance.amount).toBe('10.00'); // unchanged
  });

  it('idempotent replay returns same result', async () => {
    const wallet = await createWallet('100.00');
    const extId = uuidv4();

    const first = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${extId}`,
      providerId: 'provider-a',
      externalTransactionId: extId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const replay = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${extId}`,
      providerId: 'provider-a',
      externalTransactionId: extId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.status).toBe(first.status);
  });

  it('idempotency key reuse with different payload throws conflict', async () => {
    const { IdempotencyKeyReuseWithDifferentPayloadError } = await import(
      '../../src/shared/errors/domain.errors.js'
    );
    const wallet = await createWallet('100.00');
    const ikey = `provider-a:${uuidv4()}`;

    await makeWagerUseCase().execute({
      idempotencyKey: ikey,
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    await expect(
      makeWagerUseCase().execute({
        idempotencyKey: ikey,
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        playerId: uuidv4(),
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '99.00', currency: 'BRL' }, // different amount!
        correlationId: uuidv4(),
      }),
    ).rejects.toThrow(IdempotencyKeyReuseWithDifferentPayloadError);
  });
});

// ---------------------------------------------------------------------------
// WIN
// ---------------------------------------------------------------------------
describe('WIN integration', () => {
  it('credits wallet and returns PROCESSED', async () => {
    const wallet = await createWallet('100.00');
    const extId = uuidv4();

    const result = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${extId}`,
      providerId: 'provider-a',
      externalTransactionId: extId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Win,
      money: { amount: '50.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('150.00');
  });
});

// ---------------------------------------------------------------------------
// LOSS
// ---------------------------------------------------------------------------
describe('LOSS integration', () => {
  it('does NOT change balance and returns PROCESSED', async () => {
    const wallet = await createWallet('100.00');
    const extId = uuidv4();

    const result = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${extId}`,
      providerId: 'provider-a',
      externalTransactionId: extId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Loss,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// REFUND
// ---------------------------------------------------------------------------
describe('REFUND integration', () => {
  it('credits back a processed BET', async () => {
    const wallet = await createWallet('100.00');
    const betExtId = uuidv4();

    await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${betExtId}`,
      providerId: 'provider-a',
      externalTransactionId: betExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const refExtId = uuidv4();
    const result = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${refExtId}`,
      providerId: 'provider-a',
      externalTransactionId: refExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Refund,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExtId,
      correlationId: uuidv4(),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00'); // back to original
  });

  it('returns PENDING_REFERENCE when BET not yet processed', async () => {
    const wallet = await createWallet('100.00');
    const refExtId = uuidv4();

    const result = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${refExtId}`,
      providerId: 'provider-a',
      externalTransactionId: refExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Refund,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: 'non-existent-bet',
      correlationId: uuidv4(),
    });

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.balance.amount).toBe('100.00'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// ROLLBACK
// ---------------------------------------------------------------------------
describe('ROLLBACK integration', () => {
  it('rolls back a processed WIN (debit)', async () => {
    const wallet = await createWallet('100.00');
    const winExtId = uuidv4();

    await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${winExtId}`,
      providerId: 'provider-a',
      externalTransactionId: winExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Win,
      money: { amount: '50.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const rollbackExtId = uuidv4();
    const result = await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${rollbackExtId}`,
      providerId: 'provider-a',
      externalTransactionId: rollbackExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Rollback,
      money: { amount: '50.00', currency: 'BRL' },
      referenceExternalTransactionId: winExtId,
      correlationId: uuidv4(),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00'); // WIN reverted
  });
});

// ---------------------------------------------------------------------------
// Atomicity and reconciliation
// ---------------------------------------------------------------------------
describe('Atomicity and reconciliation', () => {
  it('wallet.balance === ledger sum after multiple operations', async () => {
    const wallet = await createWallet('1000.00');

    // BET 200
    await submitBet(wallet.id, '200.00');
    // BET 300
    await submitBet(wallet.id, '300.00');
    // WIN 100
    const winExtId = uuidv4();
    await makeWagerUseCase().execute({
      idempotencyKey: `provider-a:${winExtId}`,
      providerId: 'provider-a',
      externalTransactionId: winExtId,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Win,
      money: { amount: '100.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    // Expected: 1000 - 200 - 300 + 100 = 600
    const getUc = new GetWalletUseCase(em);
    const fetched = await getUc.execute(wallet.id);
    expect(fetched.balance.amount).toBe('600.00');

    const reconcileUc = new ReconcileWalletUseCase(em);
    const reconcile = await reconcileUc.execute(wallet.id);
    expect(reconcile.consistent).toBe(true);
    expect(reconcile.difference.amount).toBe('0.00');
    // OPENING + 2 BETs + 1 WIN = 4 entries
    expect(reconcile.checkedEntries).toBe(4);
  });

  it('outbox messages are created for every transaction', async () => {
    const wallet = await createWallet('500.00');
    await submitBet(wallet.id, '100.00');

    const count = await em.getConnection().execute<{ count: string }[]>(
      `SELECT COUNT(*) as count FROM outbox_messages WHERE aggregate_id = ?`,
      [wallet.id],
    );
    // WalletBalanceChanged for OPENING + WagerTransactionProcessed + WalletBalanceChanged for BET
    expect(Number(count[0]?.count)).toBeGreaterThanOrEqual(2);
  });
});
