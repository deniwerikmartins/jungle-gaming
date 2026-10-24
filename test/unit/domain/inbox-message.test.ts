import { describe, expect, it } from 'bun:test';
import { InboxMessage } from '../../../src/domain/shared/events/inbox-message.js';

describe('InboxMessage.receive', () => {
  it('creates an unprocessed inbox message', () => {
    const msg = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-abc',
      receivedAt: new Date(),
    });

    expect(msg.messageId).toBe('msg-1');
    expect(msg.consumerName).toBe('wager-consumer');
    expect(msg.isProcessed()).toBe(false);
    expect(msg.processedAt).toBeUndefined();
  });
});

describe('InboxMessage.markProcessed', () => {
  it('marks as processed and stores timestamp', () => {
    const msg = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-abc',
      receivedAt: new Date(),
    });
    const at = new Date();
    msg.markProcessed(at);

    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toBe(at);
  });

  it('throws if already processed', () => {
    const msg = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-abc',
      receivedAt: new Date(),
    });
    msg.markProcessed(new Date());
    expect(() => msg.markProcessed(new Date())).toThrow();
  });
});

describe('InboxMessage.rehydrate', () => {
  it('reconstructs a processed message', () => {
    const processedAt = new Date();
    const msg = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-abc',
      receivedAt: new Date(),
      processedAt,
    });

    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toBe(processedAt);
  });
});
