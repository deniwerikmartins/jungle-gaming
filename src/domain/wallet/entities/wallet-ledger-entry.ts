import { Money } from '../../shared/value-objects/money.js';
import { UnbalancedLedgerEntryError } from '../../../shared/errors/domain.errors.js';
import { LedgerDirection } from './ledger-direction.enum.js';

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}

export interface LedgerEntryState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly moneyAmount: string;
  readonly moneyCurrency: string;
  readonly balanceBeforeAmount: string;
  readonly balanceAfterAmount: string;
  readonly currency: string;
  readonly createdAt: Date;
}

/**
 * WalletLedgerEntry — Immutable audit record of every balance movement.
 *
 * Invariant: balanceBefore ± money === balanceAfter (verified in create factory).
 * Transactions with no balance effect (LOSS, REJECTED) do NOT generate entries.
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /** Creates a new ledger entry, validating the arithmetic invariant. */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError();
    }

    return entry;
  }

  /** Rehydrates from persistence — skips business validation. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    const money = Money.from({ amount: state.moneyAmount, currency: state.moneyCurrency });
    const balanceBefore = Money.from({
      amount: state.balanceBeforeAmount,
      currency: state.currency,
    });
    const balanceAfter = Money.from({
      amount: state.balanceAfterAmount,
      currency: state.currency,
    });

    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      money,
      balanceBefore,
      balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Verifies: balanceBefore ± money === balanceAfter.
   * DEBIT: balanceBefore - money === balanceAfter
   * CREDIT: balanceBefore + money === balanceAfter
   */
  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Debit
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expected.equals(this.balanceAfter);
  }
}
