/**
 * In-process metrics counters — lightweight alternative to Prometheus.
 *
 * Exposes key operational metrics via /health/ready without requiring
 * an external metrics server. Values reset on process restart.
 *
 * Metrics tracked:
 * - transactions.processed / rejected / failed / pendingReference
 * - idempotency.replays / conflicts
 * - outbox.published / retries / lag (oldest unpublished message age)
 * - locks.acquired / timeouts
 * - sqs.messagesProcessed / terminalErrors / transientErrors
 */

interface TransactionCounters {
  processed: number;
  rejected: number;
  failed: number;
  pendingReference: number;
}

interface IdempotencyCounters {
  replays: number;
  conflicts: number;
}

interface OutboxCounters {
  published: number;
  retries: number;
}

interface LockCounters {
  acquired: number;
  timeouts: number;
}

interface SqsCounters {
  messagesProcessed: number;
  terminalErrors: number;
  transientErrors: number;
}

class Metrics {
  readonly transactions: TransactionCounters = {
    processed: 0,
    rejected: 0,
    failed: 0,
    pendingReference: 0,
  };

  readonly idempotency: IdempotencyCounters = {
    replays: 0,
    conflicts: 0,
  };

  readonly outbox: OutboxCounters = {
    published: 0,
    retries: 0,
  };

  readonly locks: LockCounters = {
    acquired: 0,
    timeouts: 0,
  };

  readonly sqs: SqsCounters = {
    messagesProcessed: 0,
    terminalErrors: 0,
    transientErrors: 0,
  };

  /** Serialize all counters to a plain object for JSON serialization. */
  toJSON() {
    return {
      transactions: { ...this.transactions },
      idempotency: { ...this.idempotency },
      outbox: { ...this.outbox },
      locks: { ...this.locks },
      sqs: { ...this.sqs },
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }
}

/** Singleton metrics instance shared across the application. */
export const metrics = new Metrics();
