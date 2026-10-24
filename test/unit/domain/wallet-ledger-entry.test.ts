import { describe, expect, it } from 'bun:test';
import { WalletLedgerEntry } from '../../../src/domain/wallet/entities/wallet-ledger-entry.js';
import { LedgerDirection } from '../../../src/domain/wallet/entities/ledger-direction.enum.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { UnbalancedLedgerEntryError } from '../../../src/shared/errors/domain.errors.js';

const brl = (a: string) => Money.from({ amount: a, currency: 'BRL' });

describe('WalletLedgerEntry.create', () => {
  it('creates a valid DEBIT entry: balanceBefore - money = balanceAfter', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1',
      walletId: 'w1',
      transactionId: 't1',
      direction: LedgerDirection.Debit,
      money: brl('80.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('20.00'),
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.money.toString()).toBe('80.00');
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('20.00');
  });

  it('creates a valid CREDIT entry: balanceBefore + money = balanceAfter', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e2',
      walletId: 'w1',
      transactionId: 't2',
      direction: LedgerDirection.Credit,
      money: brl('50.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('150.00'),
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  it('throws UnbalancedLedgerEntryError when arithmetic is wrong', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e3',
        walletId: 'w1',
        transactionId: 't3',
        direction: LedgerDirection.Debit,
        money: brl('80.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('30.00'), // wrong: should be 20.00
        createdAt: new Date(),
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('is immutable — all fields are readonly (structural immutability)', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e4',
      walletId: 'w1',
      transactionId: 't4',
      direction: LedgerDirection.Credit,
      money: brl('10.00'),
      balanceBefore: brl('0.00'),
      balanceAfter: brl('10.00'),
      createdAt: new Date(),
    });

    // Immutability is enforced structurally by TypeScript readonly modifiers.
    // We verify it by asserting the values remain unchanged after creation
    // and that no mutating methods exist on the instance.
    expect(entry.money.toString()).toBe('10.00');
    expect(entry.balanceBefore.toString()).toBe('0.00');
    expect(entry.balanceAfter.toString()).toBe('10.00');

    // No transition methods — the type has no setters or state-changing methods
    // (only isBalanced() which is a pure query).
    const ownMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(entry))
      .filter((m) => m !== 'constructor');
    const mutatingMethods = ownMethods.filter(
      (m) => !['isBalanced', 'toJSON'].includes(m),
    );
    expect(mutatingMethods).toEqual([]);
  });
});

describe('WalletLedgerEntry.rehydrate', () => {
  it('rehydrates correctly without re-validating arithmetic', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'e5',
      walletId: 'w1',
      transactionId: 't5',
      direction: LedgerDirection.Debit,
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceAfterAmount: '75.00',
      currency: 'BRL',
      createdAt: new Date(),
    });

    expect(entry.id).toBe('e5');
    expect(entry.money.toString()).toBe('25.00');
    expect(entry.isBalanced()).toBe(true);
  });
});
