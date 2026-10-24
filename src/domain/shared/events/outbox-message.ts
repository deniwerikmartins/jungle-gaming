import { IntegrationEvent } from './integration-event.js';

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt: Date | undefined;
  readonly publishedAt: Date | undefined;
}

/** Exponential backoff cap in milliseconds (max ~8 minutes). */
const MAX_BACKOFF_MS = 8 * 60 * 1000;

/**
 * OutboxMessage — Transactional outbox record for async event publishing.
 *
 * A worker polls for pending outbox messages (publishedAt IS NULL, nextAttemptAt <= NOW())
 * and publishes them to SQS, then sets publishedAt.
 * On failure, scheduleRetry increments attempts and applies exponential backoff.
 */
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as unknown as Record<string, unknown>,
      event.occurredAt,
      0,
      new Date(), // ready immediately
      undefined,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) return false;
    if (this._nextAttemptAt === undefined) return true;
    return this._nextAttemptAt <= now;
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
  }

  /**
   * Increments attempts and calculates next attempt time using exponential backoff.
   * Formula: min(2^attempts * 1000ms, MAX_BACKOFF_MS)
   */
  scheduleRetry(now: Date): void {
    this._attempts += 1;
    const backoffMs = Math.min(Math.pow(2, this._attempts) * 1000, MAX_BACKOFF_MS);
    this._nextAttemptAt = new Date(now.getTime() + backoffMs);
  }
}
