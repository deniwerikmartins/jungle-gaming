import { v4 as uuidv4 } from 'uuid';
import { Money } from '../../shared/value-objects/money.js';
import {
  InsufficientFundsError,
  ReversalWouldResultInNegativeBalanceError,
} from '../../../shared/errors/domain.errors.js';
import { LedgerDirection } from './ledger-direction.enum.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balanceAmount: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DebitResult {
  readonly entry: WalletLedgerEntry;
}

export interface CreditResult {
  readonly entry: WalletLedgerEntry;
}

/**
 * Wallet — Aggregate Root.
 *
 * Invariants:
 * - At most one wallet per (playerId, currency).
 * - Balance never goes negative.
 * - Every balance change produces exactly one WalletLedgerEntry.
 * - version increments only when the balance changes.
 * - Pessimistic locking (SELECT FOR UPDATE) is enforced at the repository layer,
 *   not here — the aggregate trusts it runs inside a locked transaction.
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // --------------------------------------------------------------------------
  // Factories
  // --------------------------------------------------------------------------

  /** Creates a new wallet. version starts at 0; first debit/credit sets it to 1. */
  static open(props: OpenWalletProps): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      0,
      new Date(),
      new Date(),
    );
  }

  /** Reconstructs wallet from DB state — no business validation. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from({ amount: state.balanceAmount, currency: state.currency }),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // --------------------------------------------------------------------------
  // Balance mutations
  // --------------------------------------------------------------------------

  /**
   * Debits the wallet by the given money.
   * Throws InsufficientFundsError if balance would go negative.
   * Returns the immutable ledger entry that must be persisted.
   */
  debit(transactionId: string, money: Money, at: Date): DebitResult {
    this.assertSameCurrency(money);

    if (money.isLessThanOrEqualTo(Money.zero(this.currency))) {
      throw new Error(`Debit amount must be positive, got: ${money.toString()}`);
    }

    if (this._balance.isLessThan(money)) {
      throw new InsufficientFundsError(
        this._balance.toString(),
        money.toString(),
        this.currency,
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = at;

    const entry = WalletLedgerEntry.create({
      id: uuidv4(),
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });

    return { entry };
  }

  /**
   * Credits the wallet by the given money.
   * Throws if the credit would result in a negative balance (reversal case).
   * Returns the immutable ledger entry that must be persisted.
   */
  credit(transactionId: string, money: Money, at: Date): CreditResult {
    this.assertSameCurrency(money);

    if (money.isZero()) {
      throw new Error(`Credit amount must be positive, got: ${money.toString()}`);
    }

    // For reversals (negative money passed internally), check resulting balance
    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(money);

    if (balanceAfter.isNegative()) {
      throw new ReversalWouldResultInNegativeBalanceError();
    }

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = at;

    const entry = WalletLedgerEntry.create({
      id: uuidv4(),
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });

    return { entry };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new Error(
        `Currency mismatch: wallet is ${this.currency}, money is ${money.currency}`,
      );
    }
  }
}
