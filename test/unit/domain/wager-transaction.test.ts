import { describe, expect, it } from 'bun:test';
import { WagerTransaction } from '../../../src/domain/wagering/entities/wager-transaction.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/entities/wager-transaction.enums.js';
import { LedgerDirection } from '../../../src/domain/wallet/entities/ledger-direction.enum.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { FailureCode } from '../../../src/domain/shared/value-objects/failure-code.js';
import { InvalidTransactionStateError } from '../../../src/shared/errors/domain.errors.js';

const brl = (a: string) => Money.from({ amount: a, currency: 'BRL' });

const makeProps = (overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) => ({
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  payloadHash: 'abc123',
  walletId: 'w-1',
  playerId: 'p-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: brl('25.00'),
  createdAt: new Date(),
  ...overrides,
});

describe('WagerTransaction.create', () => {
  it('creates a BET in PENDING state', () => {
    const tx = WagerTransaction.create(makeProps());
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.kind).toBe(WagerTransactionKind.Bet);
    expect(tx.isTerminal()).toBe(false);
  });

  it('creates WIN in PENDING state', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Win }));
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
  });

  it('creates LOSS in PENDING state', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Loss }));
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.affectsBalance()).toBe(false);
  });

  it('creates REFUND with reference', () => {
    const tx = WagerTransaction.create(
      makeProps({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-bet-1',
      }),
    );
    expect(tx.referenceExternalTransactionId).toBe('ext-bet-1');
    expect(tx.requiresReference()).toBe(true);
  });

  it('creates ROLLBACK with reference', () => {
    const tx = WagerTransaction.create(
      makeProps({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-win-1',
      }),
    );
    expect(tx.requiresReference()).toBe(true);
  });

  it('throws when REFUND is created without reference', () => {
    expect(() =>
      WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Refund })),
    ).toThrow(InvalidTransactionStateError);
  });

  it('throws when ROLLBACK is created without reference', () => {
    expect(() =>
      WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Rollback })),
    ).toThrow(InvalidTransactionStateError);
  });

  it('rejects OPENING kind via create (internal only)', () => {
    expect(() =>
      WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Opening as any })),
    ).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransaction state transitions', () => {
  it('PENDING → PROCESSED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.markProcessed(undefined, new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(tx.processedAt).toBeDefined();
  });

  it('PENDING → PENDING_REFERENCE', () => {
    const tx = WagerTransaction.create(
      makeProps({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-1',
      }),
    );
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.isTerminal()).toBe(false);
  });

  it('PENDING_REFERENCE → PROCESSED', () => {
    const tx = WagerTransaction.create(
      makeProps({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-1',
      }),
    );
    tx.markPendingReference();
    tx.markProcessed('internal-ref-id', new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.referenceTransactionId).toBe('internal-ref-id');
  });

  it('PENDING → REJECTED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.reject(FailureCode.InsufficientFunds);
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.isTerminal()).toBe(true);
  });

  it('PENDING → FAILED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.fail(FailureCode.TransientInfraError);
    expect(tx.status).toBe(WagerTransactionStatus.Failed);
    expect(tx.failureCode).toBe(FailureCode.TransientInfraError);
    expect(tx.isTerminal()).toBe(true);
  });

  it('throws when transitioning from terminal PROCESSED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.markProcessed(undefined, new Date());
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
  });

  it('throws when transitioning from terminal REJECTED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.reject(FailureCode.InsufficientFunds);
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(InvalidTransactionStateError);
  });

  it('throws when transitioning from terminal FAILED', () => {
    const tx = WagerTransaction.create(makeProps());
    tx.fail(FailureCode.TransientInfraError);
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransaction domain queries', () => {
  it('affectsBalance is true for BET', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Bet }));
    expect(tx.affectsBalance()).toBe(true);
  });

  it('affectsBalance is true for WIN', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Win }));
    expect(tx.affectsBalance()).toBe(true);
  });

  it('affectsBalance is false for LOSS', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Loss }));
    expect(tx.affectsBalance()).toBe(false);
  });

  it('affectsBalance is true for REFUND', () => {
    const tx = WagerTransaction.create(
      makeProps({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'r' }),
    );
    expect(tx.affectsBalance()).toBe(true);
  });

  it('matchesPayload returns true for same hash', () => {
    const tx = WagerTransaction.create(makeProps({ payloadHash: 'hash-xyz' }));
    expect(tx.matchesPayload('hash-xyz')).toBe(true);
  });

  it('matchesPayload returns false for different hash', () => {
    const tx = WagerTransaction.create(makeProps({ payloadHash: 'hash-xyz' }));
    expect(tx.matchesPayload('hash-abc')).toBe(false);
  });
});

describe('WagerTransaction ledgerDirectionFor', () => {
  it('BET → DEBIT', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Bet }));
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it('WIN → CREDIT', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Win }));
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('REFUND → CREDIT', () => {
    const tx = WagerTransaction.create(
      makeProps({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'r' }),
    );
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('ROLLBACK of BET → CREDIT (inverse of DEBIT)', () => {
    const betTx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Bet }));
    const rollback = WagerTransaction.create(
      makeProps({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'ext-1' }),
    );
    expect(rollback.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);
  });

  it('ROLLBACK of WIN → DEBIT (inverse of CREDIT)', () => {
    const winTx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Win }));
    const rollback = WagerTransaction.create(
      makeProps({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'ext-1' }),
    );
    expect(rollback.ledgerDirectionFor(winTx)).toBe(LedgerDirection.Debit);
  });

  it('ROLLBACK without reference throws', () => {
    const rollback = WagerTransaction.create(
      makeProps({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'ext-1' }),
    );
    expect(() => rollback.ledgerDirectionFor()).toThrow();
  });

  it('LOSS throws (no ledger direction)', () => {
    const tx = WagerTransaction.create(makeProps({ kind: WagerTransactionKind.Loss }));
    expect(() => tx.ledgerDirectionFor()).toThrow();
  });
});

describe('WagerTransaction.createOpening', () => {
  it('creates an OPENING transaction in PENDING state', () => {
    const tx = WagerTransaction.createOpening({
      id: 'tx-open',
      providerId: 'system',
      externalTransactionId: 'open-1',
      idempotencyKey: 'system:open-1',
      payloadHash: 'hash-open',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'N/A',
      gameId: 'N/A',
      money: brl('1000.00'),
      createdAt: new Date(),
    });

    expect(tx.kind).toBe(WagerTransactionKind.Opening);
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('reconstructs a PROCESSED transaction without validation', () => {
    const tx = WagerTransaction.rehydrate({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-a:ext-1',
      payloadHash: 'hash',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: WagerTransactionKind.Bet,
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      status: WagerTransactionStatus.Processed,
      processedAt: new Date(),
      createdAt: new Date(),
    });

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(tx.money.toString()).toBe('25.00');
  });
});
