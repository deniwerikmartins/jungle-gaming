import { describe, expect, it } from 'bun:test';
import { Money, type MoneyProps } from '../../../src/domain/shared/value-objects/money.js';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
  NegativeMoneyError,
} from '../../../src/shared/errors/domain.errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const usd = (amount: string): Money => Money.from({ amount, currency: 'USD' });

// ---------------------------------------------------------------------------
// Construction & validation
// ---------------------------------------------------------------------------
describe('Money.from — construction and validation', () => {
  it('creates a valid Money with 2 decimal places', () => {
    const m = brl('25.00');
    expect(m.toString()).toBe('25.00');
    expect(m.currency).toBe('BRL');
  });

  it('accepts zero', () => {
    const m = brl('0.00');
    expect(m.isZero()).toBe(true);
    expect(m.toString()).toBe('0.00');
  });

  it('accepts 1 decimal place and normalizes to 2', () => {
    const m = brl('10.5');
    expect(m.toString()).toBe('10.50');
  });

  it('accepts integer strings and normalizes to 2 decimal places', () => {
    const m = brl('100');
    expect(m.toString()).toBe('100.00');
  });

  it('rejects negative amounts at input boundary', () => {
    expect(() => brl('-1.00')).toThrow(NegativeMoneyError);
    expect(() => brl('-0.01')).toThrow(NegativeMoneyError);
  });

  it('rejects amounts with more than 2 decimal places', () => {
    expect(() => brl('10.001')).toThrow(InvalidMoneyAmountError);
    expect(() => brl('0.999')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects scientific notation', () => {
    expect(() => brl('1e2')).toThrow(InvalidMoneyAmountError);
    expect(() => brl('1.5E-3')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects empty string', () => {
    expect(() => brl('')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects non-numeric strings', () => {
    expect(() => brl('abc')).toThrow(InvalidMoneyAmountError);
    expect(() => brl('25,00')).toThrow(InvalidMoneyAmountError);
    expect(() => brl('NaN')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects invalid currency codes', () => {
    expect(() => Money.from({ amount: '10.00', currency: '' })).toThrow(InvalidMoneyAmountError);
    expect(() => Money.from({ amount: '10.00', currency: 'br' })).toThrow(InvalidMoneyAmountError);
    expect(() => Money.from({ amount: '10.00', currency: 'brl' })).toThrow(InvalidMoneyAmountError);
    expect(() => Money.from({ amount: '10.00', currency: 'BRLL' })).toThrow(InvalidMoneyAmountError);
  });
});

// ---------------------------------------------------------------------------
// Money.zero
// ---------------------------------------------------------------------------
describe('Money.zero', () => {
  it('creates a zero value with the given currency', () => {
    const z = Money.zero('BRL');
    expect(z.isZero()).toBe(true);
    expect(z.toString()).toBe('0.00');
    expect(z.currency).toBe('BRL');
  });

  it('rejects invalid currency on zero', () => {
    expect(() => Money.zero('')).toThrow(InvalidMoneyAmountError);
  });
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------
describe('Money arithmetic', () => {
  it('adds two Money values', () => {
    expect(brl('10.00').add(brl('5.50')).toString()).toBe('15.50');
  });

  it('subtracts Money values', () => {
    expect(brl('100.00').subtract(brl('25.00')).toString()).toBe('75.00');
  });

  it('subtract can produce a negative intermediate value (for internal use)', () => {
    const result = brl('10.00').subtract(brl('50.00'));
    expect(result.isNegative()).toBe(true);
    expect(result.toString()).toBe('-40.00');
  });

  it('negate returns a new Money with opposite sign', () => {
    const m = brl('25.00');
    const neg = m.negate();
    expect(neg.isNegative()).toBe(true);
    expect(neg.toString()).toBe('-25.00');
    // Original unchanged (immutability)
    expect(m.toString()).toBe('25.00');
  });

  it('double negate returns to original', () => {
    expect(brl('25.00').negate().negate().toString()).toBe('25.00');
  });

  it('preserves exactly 2 decimal places after arithmetic', () => {
    const result = brl('10.10').add(brl('0.05'));
    expect(result.toString()).toBe('10.15');
  });

  it('each arithmetic operation returns a new immutable instance', () => {
    const a = brl('50.00');
    const b = brl('30.00');
    const sum = a.add(b);
    // Original instances unchanged
    expect(a.toString()).toBe('50.00');
    expect(b.toString()).toBe('30.00');
    expect(sum.toString()).toBe('80.00');
  });

  it('throws CurrencyMismatchError when adding different currencies', () => {
    expect(() => brl('10.00').add(usd('10.00'))).toThrow(CurrencyMismatchError);
  });

  it('throws CurrencyMismatchError when subtracting different currencies', () => {
    expect(() => brl('10.00').subtract(usd('10.00'))).toThrow(CurrencyMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------
describe('Money comparisons', () => {
  it('isZero is true for zero amount', () => {
    expect(brl('0.00').isZero()).toBe(true);
    expect(brl('0.01').isZero()).toBe(false);
  });

  it('isPositive is true only for values > 0', () => {
    expect(brl('0.01').isPositive()).toBe(true);
    expect(brl('0.00').isPositive()).toBe(false);
  });

  it('isNegative is true for negative internal values', () => {
    const neg = brl('5.00').subtract(brl('10.00'));
    expect(neg.isNegative()).toBe(true);
  });

  it('isLessThan compares correctly', () => {
    expect(brl('5.00').isLessThan(brl('10.00'))).toBe(true);
    expect(brl('10.00').isLessThan(brl('5.00'))).toBe(false);
    expect(brl('10.00').isLessThan(brl('10.00'))).toBe(false);
  });

  it('isLessThanOrEqualTo compares correctly', () => {
    expect(brl('10.00').isLessThanOrEqualTo(brl('10.00'))).toBe(true);
    expect(brl('9.99').isLessThanOrEqualTo(brl('10.00'))).toBe(true);
    expect(brl('10.01').isLessThanOrEqualTo(brl('10.00'))).toBe(false);
  });

  it('isGreaterThan compares correctly', () => {
    expect(brl('10.00').isGreaterThan(brl('5.00'))).toBe(true);
    expect(brl('5.00').isGreaterThan(brl('10.00'))).toBe(false);
  });

  it('equals returns true for same amount and currency', () => {
    expect(brl('25.00').equals(brl('25.00'))).toBe(true);
  });

  it('equals returns false for different amounts', () => {
    expect(brl('25.00').equals(brl('25.01'))).toBe(false);
  });

  it('equals returns false for different currencies', () => {
    expect(brl('25.00').equals(usd('25.00'))).toBe(false);
  });

  it('isLessThan throws on currency mismatch', () => {
    expect(() => brl('10.00').isLessThan(usd('10.00'))).toThrow(CurrencyMismatchError);
  });

  it('isGreaterThan throws on currency mismatch', () => {
    expect(() => brl('10.00').isGreaterThan(usd('10.00'))).toThrow(CurrencyMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
describe('Money serialization', () => {
  it('toJSON returns MoneyProps with 2 decimal places', () => {
    const m = brl('42.50');
    const json: MoneyProps = m.toJSON();
    expect(json).toEqual({ amount: '42.50', currency: 'BRL' });
  });

  it('toString returns the decimal string', () => {
    expect(brl('1.00').toString()).toBe('1.00');
    expect(brl('100').toString()).toBe('100.00');
  });

  it('round-trips through from(toJSON())', () => {
    const original = brl('123.45');
    const restored = Money.from(original.toJSON());
    expect(restored.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Precision edge cases
// ---------------------------------------------------------------------------
describe('Money precision edge cases', () => {
  it('handles large amounts without precision loss', () => {
    const big = brl('9999999.99');
    const added = big.add(brl('0.01'));
    expect(added.toString()).toBe('10000000.00');
  });

  it('does not introduce floating point errors (0.1 + 0.2 === 0.3)', () => {
    const result = brl('0.10').add(brl('0.20'));
    expect(result.toString()).toBe('0.30');
    expect(result.equals(brl('0.30'))).toBe(true);
  });

  it('handles exact boundary: 100.00 - 80.00 = 20.00', () => {
    const balance = brl('100.00');
    const bet = brl('80.00');
    const remaining = balance.subtract(bet);
    expect(remaining.toString()).toBe('20.00');
    expect(remaining.isPositive()).toBe(true);
  });

  it('1 cent = minimum non-zero positive amount', () => {
    const cent = brl('0.01');
    expect(cent.isPositive()).toBe(true);
    expect(cent.isZero()).toBe(false);
  });
});
