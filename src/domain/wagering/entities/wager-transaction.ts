import { Money } from '../../shared/value-objects/money.js';
import { FailureCode } from '../../shared/value-objects/failure-code.js';
import { LedgerDirection } from '../../wallet/entities/ledger-direction.enum.js';
import { InvalidTransactionStateError } from '../../../shared/errors/domain.errors.js';
import {
  EXTERNAL_KINDS,
  KINDS_REQUIRING_REFERENCE,
  TERMINAL_STATUSES,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction.enums.js';

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt: Date;
}

export interface WagerTransactionState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly moneyAmount: string;
  readonly moneyCurrency: string;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode;
  readonly processedAt?: Date;
  readonly createdAt: Date;
}

/**
 * WagerTransaction — Entity representing a single wagering operation.
 *
 * Lifecycle:
 *   PENDING → PROCESSED | REJECTED | FAILED | PENDING_REFERENCE
 *   PENDING_REFERENCE → PROCESSED | REJECTED | FAILED
 *
 * Terminal states: PROCESSED, REJECTED, FAILED — no further transitions.
 * OPENING is internal only — cannot be submitted via API or SQS.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
  ) {}

  // --------------------------------------------------------------------------
  // Factories
  // --------------------------------------------------------------------------

  /**
   * Creates a new transaction in PENDING state.
   * Validates that external kinds are used and reference is present when required.
   */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!EXTERNAL_KINDS.has(props.kind)) {
      throw new InvalidTransactionStateError(
        'N/A',
        `${props.kind} is not allowed via external submission`,
      );
    }

    if (KINDS_REQUIRING_REFERENCE.has(props.kind) && !props.referenceExternalTransactionId) {
      throw new InvalidTransactionStateError(
        props.kind,
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
    );
  }

  /**
   * Internal factory for OPENING transactions — bypasses external validation.
   */
  static createOpening(props: Omit<CreateWagerTransactionProps, 'kind' | 'referenceExternalTransactionId'>): WagerTransaction {
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
    );
  }

  /** Reconstructs from DB state — no transition validation. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from({ amount: state.moneyAmount, currency: state.moneyCurrency }),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  // --------------------------------------------------------------------------
  // State transitions
  // --------------------------------------------------------------------------

  /** Transitions to PROCESSED (terminal). */
  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNonTerminal('PROCESSED');
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  /** Transitions to PENDING_REFERENCE. */
  markPendingReference(): void {
    this.assertNonTerminal('PENDING_REFERENCE');
    this._status = WagerTransactionStatus.PendingReference;
  }

  /** Transitions to REJECTED (terminal) with a failure code. */
  reject(code: FailureCode): void {
    this.assertNonTerminal('REJECTED');
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  /** Transitions to FAILED (terminal) with a failure code. */
  fail(code: FailureCode): void {
    this.assertNonTerminal('FAILED');
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  // --------------------------------------------------------------------------
  // Domain queries
  // --------------------------------------------------------------------------

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  /** Returns false for LOSS — it records outcome without moving balance. */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return KINDS_REQUIRING_REFERENCE.has(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Returns the ledger direction for this transaction.
   * For ROLLBACK, the direction is the inverse of the referenced transaction.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new Error('Rollback requires a reference transaction to determine ledger direction');
        }
        // Inverse of the referenced transaction's direction
        const refDirection = reference.ledgerDirectionFor();
        return refDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }

      case WagerTransactionKind.Loss:
        throw new Error('LOSS does not generate a ledger entry');
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private assertNonTerminal(to: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, to);
    }
  }
}
