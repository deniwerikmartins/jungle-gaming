import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../../src/domain/wallet/entities/wallet.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { LedgerDirection } from '../../../src/domain/wallet/entities/ledger-direction.enum.js';
import {
  InsufficientFundsError,
  ReversalWouldResultInNegativeBalanceError,
} from '../../../src/shared/errors/domain.errors.js';

const brl = (a: string) => Money.from({ amount: a, currency: 'BRL' });

const openWallet = (initialBalance = '100.00') =>
  Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl(initialBalance) });

describe('Wallet.open', () => {
  it('creates wallet with given initial balance', () => {
    const w = openWallet('1000.00');
    expect(w.balance.toString()).toBe('1000.00');
    expect(w.currency).toBe('BRL');
    expect(w.version).toBe(0);
    expect(w.playerId).toBe('p1');
  });

  it('creates wallet with zero initial balance', () => {
    const w = openWallet('0.00');
    expect(w.balance.isZero()).toBe(true);
    expect(w.version).toBe(0);
  });
});

describe('Wallet.debit', () => {
  it('debits correctly and returns a DEBIT ledger entry', () => {
    const w = openWallet('100.00');
    const at = new Date();
    const { entry } = w.debit('t1', brl('80.00'), at);

    expect(w.balance.toString()).toBe('20.00');
    expect(w.version).toBe(1);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.money.toString()).toBe('80.00');
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
    expect(entry.transactionId).toBe('t1');
    expect(entry.walletId).toBe('w1');
  });

  it('allows full debit (balance becomes exactly zero)', () => {
    const w = openWallet('100.00');
    w.debit('t1', brl('100.00'), new Date());
    expect(w.balance.isZero()).toBe(true);
    expect(w.version).toBe(1);
  });

  it('throws InsufficientFundsError when balance is too low', () => {
    const w = openWallet('100.00');
    expect(() => w.debit('t1', brl('100.01'), new Date())).toThrow(InsufficientFundsError);
  });

  it('increments version on each successful debit', () => {
    const w = openWallet('200.00');
    w.debit('t1', brl('50.00'), new Date());
    w.debit('t2', brl('50.00'), new Date());
    expect(w.version).toBe(2);
    expect(w.balance.toString()).toBe('100.00');
  });

  it('does not mutate balance on failed debit', () => {
    const w = openWallet('10.00');
    expect(() => w.debit('t1', brl('50.00'), new Date())).toThrow(InsufficientFundsError);
    expect(w.balance.toString()).toBe('10.00');
    expect(w.version).toBe(0);
  });

  it('throws on zero debit amount', () => {
    const w = openWallet('100.00');
    expect(() => w.debit('t1', brl('0.00'), new Date())).toThrow();
  });
});

describe('Wallet.credit', () => {
  it('credits correctly and returns a CREDIT ledger entry', () => {
    const w = openWallet('100.00');
    const at = new Date();
    const { entry } = w.credit('t1', brl('50.00'), at);

    expect(w.balance.toString()).toBe('150.00');
    expect(w.version).toBe(1);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.money.toString()).toBe('50.00');
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('150.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('credits a wallet from zero balance', () => {
    const w = openWallet('0.00');
    w.credit('t1', brl('100.00'), new Date());
    expect(w.balance.toString()).toBe('100.00');
    expect(w.version).toBe(1);
  });

  it('throws ReversalWouldResultInNegativeBalanceError when credit results in negative', () => {
    // Simulate a reversal where the wallet was already in a low state
    const w = openWallet('10.00');
    // Manually construct a negative money via internal path (negate)
    const negativeMoney = brl('50.00').negate();
    expect(() => w.credit('t1', negativeMoney, new Date())).toThrow(
      ReversalWouldResultInNegativeBalanceError,
    );
  });

  it('increments version on each credit', () => {
    const w = openWallet('0.00');
    w.credit('t1', brl('10.00'), new Date());
    w.credit('t2', brl('20.00'), new Date());
    expect(w.version).toBe(2);
    expect(w.balance.toString()).toBe('30.00');
  });
});

describe('Wallet invariants', () => {
  it('balance never goes negative after concurrent-style debits', () => {
    const w = openWallet('100.00');
    w.debit('t1', brl('80.00'), new Date());
    // Second debit should fail — 20.00 < 80.00
    expect(() => w.debit('t2', brl('80.00'), new Date())).toThrow(InsufficientFundsError);
    expect(w.balance.toString()).toBe('20.00');
  });

  it('ledger entry walletId matches wallet id', () => {
    const w = Wallet.open({ id: 'wallet-abc', playerId: 'p1', initialBalance: brl('100.00') });
    const { entry } = w.debit('t1', brl('10.00'), new Date());
    expect(entry.walletId).toBe('wallet-abc');
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstructs state without triggering invariant checks', () => {
    const w = Wallet.rehydrate({
      id: 'w1',
      playerId: 'p1',
      currency: 'BRL',
      balanceAmount: '500.00',
      version: 5,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-06-01'),
    });

    expect(w.balance.toString()).toBe('500.00');
    expect(w.version).toBe(5);
    expect(w.currency).toBe('BRL');
  });
});
