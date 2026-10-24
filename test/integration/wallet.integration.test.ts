/**
 * Integration tests — Wallet creation, balance queries and ledger.
 * Requires: PostgreSQL running (docker compose up postgres)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { getTestEm, cleanDatabase, closeTestOrm } from './helpers/db.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../src/application/wallet/get-wallet.use-case.js';
import { GetLedgerUseCase } from '../../src/application/wallet/get-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../src/application/wallet/reconcile-wallet.use-case.js';
import { WalletAlreadyExistsError, WalletNotFoundError } from '../../src/shared/errors/domain.errors.js';
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

describe('CreateWallet integration', () => {
  it('creates a wallet with initial balance and OPENING ledger entry', async () => {
    const uc = new CreateWalletUseCase(em);
    const result = await uc.execute({
      playerId: uuidv4(),
      initialBalance: { amount: '1000.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    expect(result.balance.amount).toBe('1000.00');
    expect(result.balance.currency).toBe('BRL');
    expect(result.version).toBe(1);
    expect(result.id).toBeDefined();
  });

  it('creates a wallet with zero balance (no ledger entry)', async () => {
    const uc = new CreateWalletUseCase(em);
    const result = await uc.execute({
      playerId: uuidv4(),
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    expect(result.balance.amount).toBe('0.00');
    expect(result.version).toBe(0);
  });

  it('rejects duplicate wallet for same playerId + currency', async () => {
    const uc = new CreateWalletUseCase(em);
    const playerId = uuidv4();

    await uc.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    await expect(
      uc.execute({
        playerId,
        initialBalance: { amount: '200.00', currency: 'BRL' },
        correlationId: uuidv4(),
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);
  });

  it('allows same player to have wallets in different currencies', async () => {
    const uc = new CreateWalletUseCase(em);
    const playerId = uuidv4();

    const brl = await uc.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });
    const usd = await uc.execute({
      playerId,
      initialBalance: { amount: '50.00', currency: 'USD' },
      correlationId: uuidv4(),
    });

    expect(brl.balance.currency).toBe('BRL');
    expect(usd.balance.currency).toBe('USD');
  });
});

describe('GetWallet integration', () => {
  it('returns wallet data after creation', async () => {
    const createUc = new CreateWalletUseCase(em);
    const getUc = new GetWalletUseCase(em);
    const playerId = uuidv4();

    const created = await createUc.execute({
      playerId,
      initialBalance: { amount: '500.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const fetched = await getUc.execute(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.balance.amount).toBe('500.00');
    expect(fetched.version).toBe(1);
  });

  it('throws WalletNotFoundError for unknown walletId', async () => {
    const uc = new GetWalletUseCase(em);
    await expect(uc.execute(uuidv4())).rejects.toThrow(WalletNotFoundError);
  });
});

describe('GetLedger integration', () => {
  it('returns ledger entries after a transaction', async () => {
    const { ProcessWagerTransactionUseCase } = await import(
      '../../src/application/wagering/process-wager-transaction.use-case.js'
    );
    const { WagerTransactionKind } = await import(
      '../../src/domain/wagering/entities/wager-transaction.enums.js'
    );
    const { WalletRepository } = await import(
      '../../src/infrastructure/database/repositories/wallet.repository.js'
    );
    const { WagerTransactionRepository } = await import(
      '../../src/infrastructure/database/repositories/wager-transaction.repository.js'
    );
    const { WalletLedgerEntryRepository } = await import(
      '../../src/infrastructure/database/repositories/wallet-ledger-entry.repository.js'
    );
    const { OutboxMessageRepository } = await import(
      '../../src/infrastructure/database/repositories/outbox-message.repository.js'
    );

    const createUc = new CreateWalletUseCase(em);
    const wallet = await createUc.execute({
      playerId: uuidv4(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const betUc = new ProcessWagerTransactionUseCase(
      em,
      new WalletRepository(em),
      new WagerTransactionRepository(em),
      new WalletLedgerEntryRepository(em),
      new OutboxMessageRepository(em),
    );

    const ikey = `provider-a:${uuidv4()}`;
    await betUc.execute({
      idempotencyKey: ikey,
      providerId: 'provider-a',
      externalTransactionId: ikey,
      playerId: uuidv4(),
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const ledgerUc = new GetLedgerUseCase(em);
    const page = await ledgerUc.execute(wallet.id, 50);

    // OPENING credit + BET debit
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBeNull();
  });
});

describe('ReconcileWallet integration', () => {
  it('reports consistent=true when balance matches ledger', async () => {
    const createUc = new CreateWalletUseCase(em);
    const wallet = await createUc.execute({
      playerId: uuidv4(),
      initialBalance: { amount: '1000.00', currency: 'BRL' },
      correlationId: uuidv4(),
    });

    const reconcileUc = new ReconcileWalletUseCase(em);
    const result = await reconcileUc.execute(wallet.id);

    expect(result.consistent).toBe(true);
    expect(result.storedBalance.amount).toBe('1000.00');
    expect(result.calculatedBalance.amount).toBe('1000.00');
    expect(result.difference.amount).toBe('0.00');
    expect(result.checkedEntries).toBe(1);
  });
});
