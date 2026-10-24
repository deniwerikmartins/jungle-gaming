/**
 * Stable, machine-readable failure codes.
 * Every rejection or failure carries one of these so providers can
 * decide whether to resend, correct the payload, or give up.
 */
export enum FailureCode {
  // ---- balance / financial ----
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalWouldResultInNegativeBalance = 'REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE',

  // ---- reference / state ----
  ReferenceAlreadyReverted = 'REFERENCE_ALREADY_REVERTED',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceTransactionNotProcessed = 'REFERENCE_TRANSACTION_NOT_PROCESSED',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  AmountMismatch = 'AMOUNT_MISMATCH',
  PlayerMismatch = 'PLAYER_MISMATCH',
  WalletMismatch = 'WALLET_MISMATCH',
  RoundMismatch = 'ROUND_MISMATCH',
  ProviderMismatch = 'PROVIDER_MISMATCH',

  // ---- idempotency ----
  IdempotencyKeyReuseWithDifferentPayload = 'IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD',

  // ---- infrastructure ----
  PendingReferenceMaxRetriesExceeded = 'PENDING_REFERENCE_MAX_RETRIES_EXCEEDED',
  TransientInfraError = 'TRANSIENT_INFRA_ERROR',
}
