export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

/** Terminal statuses — no further transitions allowed. */
export const TERMINAL_STATUSES = new Set<WagerTransactionStatus>([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

/** Kinds that require a referenceExternalTransactionId. */
export const KINDS_REQUIRING_REFERENCE = new Set<WagerTransactionKind>([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

/** Kinds submitted externally — OPENING is internal only. */
export const EXTERNAL_KINDS = new Set<WagerTransactionKind>([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);
