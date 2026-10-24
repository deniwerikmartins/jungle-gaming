import Decimal from 'decimal.js';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
  NegativeMoneyError,
} from '../../../shared/errors/domain.errors.js';

/**
 * DTO for serializing/deserializing Money.
 * amount is always a decimal string with exactly 2 decimal places.
 */
export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Money — Immutable value object encapsulating decimal arithmetic.
 *
 * Rules:
 * - amount is received and serialized as decimal string with exactly 2 places.
 * - Operations between different currencies throw CurrencyMismatchError.
 * - Invalid inputs (NaN, Infinity, scientific notation, empty string,
 *   > 2 decimal places) throw InvalidMoneyAmountError.
 * - Negative values at input boundaries throw NegativeMoneyError.
 * - The domain does NOT depend on ORM types or NestJS decorators.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  // --------------------------------------------------------------------------
  // Factories
  // --------------------------------------------------------------------------

  /**
   * Primary factory for constructing Money from external input.
   * Validates format and rejects negative values.
   */
  static from(props: MoneyProps): Money {
    Money.assertValidCurrency(props.currency);
    const decimal = Money.parseAndValidate(props.amount);

    if (decimal.isNegative()) {
      throw new NegativeMoneyError(props.amount);
    }

    return new Money(decimal, props.currency);
  }

  /**
   * Factory for zero amounts — used as balance initialization.
   */
  static zero(currency: string): Money {
    Money.assertValidCurrency(currency);
    return new Money(new Decimal('0.00'), currency);
  }

  /**
   * Internal factory used by arithmetic operations.
   * Allows intermediate negative values (e.g., for negate()).
   */
  private static fromDecimalUnchecked(value: Decimal, currency: string): Money {
    return new Money(value.toDecimalPlaces(2), currency);
  }

  // --------------------------------------------------------------------------
  // Arithmetic (each returns a new immutable instance)
  // --------------------------------------------------------------------------

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimalUnchecked(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimalUnchecked(this.value.minus(other.value), this.currency);
  }

  /**
   * Returns a new Money with negated amount.
   * Useful for reversal operations.
   */
  negate(): Money {
    return Money.fromDecimalUnchecked(this.value.negated(), this.currency);
  }

  // --------------------------------------------------------------------------
  // Comparisons / queries
  // --------------------------------------------------------------------------

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isLessThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  // --------------------------------------------------------------------------
  // Serialization
  // --------------------------------------------------------------------------

  /** Returns the decimal string representation with exactly 2 decimal places. */
  toString(): string {
    return this.value.toFixed(2);
  }

  /** JSON-safe representation matching the API contract. */
  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  /** Raw Decimal.js value — for internal ORM persistence only. */
  toDecimal(): Decimal {
    return this.value;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static assertValidCurrency(currency: string): void {
    if (!currency || typeof currency !== 'string' || currency.trim().length === 0) {
      throw new InvalidMoneyAmountError('Currency must be a non-empty string');
    }
    // Basic ISO-4217 format: 3 uppercase letters
    if (!/^[A-Z]{3}$/.test(currency.trim())) {
      throw new InvalidMoneyAmountError(
        `Currency "${currency}" is not a valid ISO-4217 code (3 uppercase letters required)`,
      );
    }
  }

  private static parseAndValidate(amount: string): Decimal {
    if (!amount || typeof amount !== 'string' || amount.trim().length === 0) {
      throw new InvalidMoneyAmountError('Money amount must be a non-empty string');
    }

    const trimmed = amount.trim();

    // Reject scientific notation (e.g. "1e2", "1.5E-3")
    if (/[eE]/.test(trimmed)) {
      throw new InvalidMoneyAmountError(
        `Scientific notation is not allowed for money: "${trimmed}"`,
      );
    }

    // Validate that it's a proper decimal string (allows optional leading minus)
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new InvalidMoneyAmountError(`Invalid decimal format for money: "${trimmed}"`);
    }

    let decimal: Decimal;
    try {
      decimal = new Decimal(trimmed);
    } catch {
      throw new InvalidMoneyAmountError(`Cannot parse money amount: "${trimmed}"`);
    }

    if (!decimal.isFinite()) {
      throw new InvalidMoneyAmountError(
        `Money amount must be finite, got: "${trimmed}"`,
      );
    }

    // Enforce at most 2 decimal places.
    // Strip the leading minus before measuring so "-0.01" is treated as "0.01" (2 places, valid).
    const absolute = trimmed.replace(/^-/, '');
    const dotIndex = absolute.indexOf('.');
    if (dotIndex !== -1) {
      const decimalPlaces = absolute.length - dotIndex - 1;
      if (decimalPlaces > 2) {
        throw new InvalidMoneyAmountError(
          `Money amount "${trimmed}" has more than 2 decimal places`,
        );
      }
    }

    // Normalize to exactly 2 decimal places
    return decimal.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  }
}
