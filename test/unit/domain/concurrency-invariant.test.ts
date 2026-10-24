/**
 * Concurrency invariant test — domain layer only (no DB, pure in-memory).
 *
 * Verifies that the domain correctly rejects all but one of 50 simultaneous
 * BET attempts on a wallet with balance 100.00 BRL when each bet is 80.00 BRL.
 *
 * The real concurrent test (with actual DB pessimistic locks) lives in
 * test/integration/concurrency.test.ts — that one requires PostgreSQL.
 *
 * This unit test validates the invariant logic itself is sound.
 */
import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../../src/domain/wallet/entities/wallet.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { InsufficientFundsError } from '../../../src/shared/errors/domain.errors.js';
import { LedgerDirection } from '../../../src/domain/wallet/entities/ledger-direction.enum.js';

const brl = (a: string) => Money.from({ amount: a, currency: 'BRL' });

describe('Concurrency invariant — domain-level simulation', () => {
  it('exactly 1 of 50 bets of 80.00 succeeds on a 100.00 wallet (sequential simulation)', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('100.00') });
    const betAmount = brl('80.00');
    const N = 50;

    let processed = 0;
    let rejected = 0;
    const ledgerEntries: ReturnType<typeof wallet.debit>['entry'][] = [];

    // Simulate N sequential attempts (domain doesn't know they're "concurrent" —
    // the DB lock is what serialises them in integration; here we test the invariant)
    for (let i = 0; i < N; i++) {
      try {
        const { entry } = wallet.debit(`tx-${i}`, betAmount, new Date());
        processed++;
        ledgerEntries.push(entry);
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          rejected++;
        } else {
          throw err;
        }
      }
    }

    expect(processed).toBe(1);
    expect(rejected).toBe(49);
    expect(wallet.balance.toString()).toBe('20.00');
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]!.direction).toBe(LedgerDirection.Debit);
    expect(ledgerEntries[0]!.money.toString()).toBe('80.00');
    expect(ledgerEntries[0]!.balanceBefore.toString()).toBe('100.00');
    expect(ledgerEntries[0]!.balanceAfter.toString()).toBe('20.00');
  });

  it('balance invariant holds after mix of debits and credits', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('1000.00') });
    const now = new Date();

    wallet.debit('t1', brl('300.00'), now);  // 700
    wallet.credit('t2', brl('500.00'), now); // 1200
    wallet.debit('t3', brl('200.00'), now);  // 1000
    wallet.debit('t4', brl('999.99'), now);  // 0.01

    expect(wallet.balance.toString()).toBe('0.01');
    expect(wallet.version).toBe(4);

    // Invariant: can't debit more than remaining
    expect(() => wallet.debit('t5', brl('0.02'), now)).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe('0.01'); // unchanged after failed debit
  });

  it('ledger entries are balanced for every operation', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: brl('500.00') });
    const now = new Date();
    const entries = [];

    const { entry: e1 } = wallet.debit('t1', brl('100.00'), now);
    entries.push(e1);
    const { entry: e2 } = wallet.credit('t2', brl('200.00'), now);
    entries.push(e2);
    const { entry: e3 } = wallet.debit('t3', brl('50.00'), now);
    entries.push(e3);

    for (const entry of entries) {
      expect(entry.isBalanced()).toBe(true);
    }

    // Reconstructed balance from ledger matches wallet balance
    let reconstructed = brl('500.00'); // initial (not in ledger — pre-exists)
    // Actually compute from opening zero
    let calc = brl('0.00');
    // The wallet was opened with 500.00 as initial — ledger starts from first mutation
    // So reconstruct from wallet's first balance before
    const firstEntry = entries[0]!;
    calc = firstEntry.balanceBefore;
    for (const entry of entries) {
      if (entry.direction === LedgerDirection.Debit) {
        calc = calc.subtract(entry.money);
      } else {
        calc = calc.add(entry.money);
      }
    }

    expect(calc.toString()).toBe(wallet.balance.toString());
  });

  it('wallet.balance === sum reconstructed from ledger (invariant verification)', () => {
    const initial = brl('100.00');
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: initial });
    const now = new Date();
    const ops: Array<{ debit: boolean; amount: string }> = [
      { debit: true, amount: '20.00' },
      { debit: false, amount: '50.00' },
      { debit: true, amount: '30.00' },
      { debit: false, amount: '10.00' },
    ];

    let expected = initial;
    const entries = [];

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      const money = brl(op.amount);
      if (op.debit) {
        const { entry } = wallet.debit(`t${i}`, money, now);
        expected = expected.subtract(money);
        entries.push(entry);
      } else {
        const { entry } = wallet.credit(`t${i}`, money, now);
        expected = expected.add(money);
        entries.push(entry);
      }
    }

    expect(wallet.balance.toString()).toBe(expected.toString());

    // Verify via last entry's balanceAfter
    const lastEntry = entries[entries.length - 1]!;
    expect(lastEntry.balanceAfter.toString()).toBe(wallet.balance.toString());
  });
});
