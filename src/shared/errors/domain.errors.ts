/**
 * Base class for all domain errors.
 * Domain errors represent invariant violations, not infrastructure failures.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Money errors
// ---------------------------------------------------------------------------

export class InvalidMoneyAmountError extends DomainError {
  readonly code = 'INVALID_MONEY_AMOUNT';

  constructor(message: string) {
    super(message);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(left: string, right: string) {
    super(`Currency mismatch: cannot operate on ${left} and ${right}`);
  }
}

export class NegativeMoneyError extends DomainError {
  readonly code = 'NEGATIVE_MONEY';

  constructor(amount: string) {
    super(`Money amount cannot be negative in this context: ${amount}`);
  }
}

// ---------------------------------------------------------------------------
// Wallet errors
// ---------------------------------------------------------------------------

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(available: string, required: string, currency: string) {
    super(
      `Insufficient funds: available ${available} ${currency}, required ${required} ${currency}`,
    );
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(playerId: string, currency: string) {
    super(`Wallet already exists for player ${playerId} and currency ${currency}`);
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`);
  }
}

// ---------------------------------------------------------------------------
// WagerTransaction errors
// ---------------------------------------------------------------------------

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(from: string, to: string) {
    super(`Cannot transition WagerTransaction from ${from} to ${to}`);
  }
}

export class TransactionNotFoundError extends DomainError {
  readonly code = 'TRANSACTION_NOT_FOUND';

  constructor(transactionId: string) {
    super(`WagerTransaction not found: ${transactionId}`);
  }
}

export class ReferenceAlreadyRevertedError extends DomainError {
  readonly code = 'REFERENCE_ALREADY_REVERTED';

  constructor(referenceId: string) {
    super(`Transaction ${referenceId} has already been reverted`);
  }
}

export class ReversalWouldResultInNegativeBalanceError extends DomainError {
  readonly code = 'REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE';

  constructor() {
    super('Reversal would result in negative balance');
  }
}

// ---------------------------------------------------------------------------
// Idempotency errors
// ---------------------------------------------------------------------------

export class IdempotencyKeyReuseWithDifferentPayloadError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD';

  constructor(key: string) {
    super(`Idempotency key "${key}" already used with a different payload`);
  }
}

// ---------------------------------------------------------------------------
// WalletLedgerEntry errors
// ---------------------------------------------------------------------------

export class UnbalancedLedgerEntryError extends DomainError {
  readonly code = 'UNBALANCED_LEDGER_ENTRY';

  constructor() {
    super('Ledger entry is not balanced: balanceBefore ± money ≠ balanceAfter');
  }
}
