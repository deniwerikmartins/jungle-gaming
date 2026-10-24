import { describe, expect, it } from 'bun:test';
import { OutboxMessage } from '../../../src/domain/shared/events/outbox-message.js';
import { IntegrationEvent, type IntegrationEventProps } from '../../../src/domain/shared/events/integration-event.js';

// Minimal concrete event for testing
class TestEvent extends IntegrationEvent<{ value: string }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<{ value: string }>) {
    super(props);
  }
}

const makeEvent = () =>
  new TestEvent({
    eventId: 'ev-1',
    aggregateId: 'agg-1',
    correlationId: 'corr-1',
    occurredAt: new Date('2024-01-01T00:00:00Z'),
    data: { value: 'hello' },
  });

describe('OutboxMessage.enqueue', () => {
  it('creates a pending outbox message from an integration event', () => {
    const event = makeEvent();
    const msg = OutboxMessage.enqueue(event as unknown as IntegrationEvent<unknown>);

    expect(msg.id).toBe('ev-1');
    expect(msg.aggregateId).toBe('agg-1');
    expect(msg.eventType).toBe('TestEvent');
    expect(msg.attempts).toBe(0);
    expect(msg.isPending()).toBe(true);
    expect(msg.publishedAt).toBeUndefined();
  });

  it('isDue returns true immediately after enqueue', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    expect(msg.isDue(new Date())).toBe(true);
  });
});

describe('OutboxMessage lifecycle', () => {
  it('markPublished sets publishedAt and makes isPending false', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    const at = new Date();
    msg.markPublished(at);
    expect(msg.isPending()).toBe(false);
    expect(msg.publishedAt).toBe(at);
    expect(msg.isDue(new Date())).toBe(false);
  });

  it('scheduleRetry increments attempts and sets future nextAttemptAt', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    const now = new Date();
    msg.scheduleRetry(now);

    expect(msg.attempts).toBe(1);
    expect(msg.nextAttemptAt).toBeDefined();
    // backoff: 2^1 * 1000 = 2000ms
    expect(msg.nextAttemptAt!.getTime()).toBe(now.getTime() + 2000);
  });

  it('scheduleRetry applies exponential backoff', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    const now = new Date();
    msg.scheduleRetry(now); // attempt 1 → 2s
    msg.scheduleRetry(now); // attempt 2 → 4s
    msg.scheduleRetry(now); // attempt 3 → 8s

    expect(msg.attempts).toBe(3);
    expect(msg.nextAttemptAt!.getTime()).toBe(now.getTime() + 8000);
  });

  it('isDue returns false when nextAttemptAt is in the future', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    const now = new Date();
    msg.scheduleRetry(now);
    // Check 1ms before the scheduled time
    const before = new Date(msg.nextAttemptAt!.getTime() - 1);
    expect(msg.isDue(before)).toBe(false);
    // Check at or after the scheduled time
    expect(msg.isDue(msg.nextAttemptAt!)).toBe(true);
  });

  it('caps backoff at MAX_BACKOFF_MS (8 minutes)', () => {
    const msg = OutboxMessage.enqueue(makeEvent() as unknown as IntegrationEvent<unknown>);
    const now = new Date();
    // After ~13 retries, 2^13 * 1000 = 8192000ms > 480000ms cap
    for (let i = 0; i < 15; i++) msg.scheduleRetry(now);

    const maxBackoffMs = 8 * 60 * 1000;
    expect(msg.nextAttemptAt!.getTime()).toBe(now.getTime() + maxBackoffMs);
  });
});

describe('OutboxMessage.rehydrate', () => {
  it('reconstructs from state', () => {
    const now = new Date();
    const msg = OutboxMessage.rehydrate({
      id: 'msg-1',
      aggregateId: 'agg-1',
      eventType: 'SomeEvent',
      payload: { foo: 'bar' },
      occurredAt: now,
      attempts: 3,
      nextAttemptAt: new Date(now.getTime() + 8000),
      publishedAt: undefined,
    });

    expect(msg.id).toBe('msg-1');
    expect(msg.attempts).toBe(3);
    expect(msg.isPending()).toBe(true);
  });
});
