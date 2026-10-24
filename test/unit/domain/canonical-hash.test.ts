import { describe, expect, it } from 'bun:test';
import { generateCanonicalPayloadHash } from '../../../src/shared/utils/canonical-hash.js';

describe('generateCanonicalPayloadHash', () => {
  it('produces the same hash regardless of key order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(generateCanonicalPayloadHash(a)).toBe(generateCanonicalPayloadHash(b));
  });

  it('produces different hashes for different values', () => {
    const a = { amount: '25.00', currency: 'BRL' };
    const b = { amount: '26.00', currency: 'BRL' };
    expect(generateCanonicalPayloadHash(a)).not.toBe(generateCanonicalPayloadHash(b));
  });

  it('handles nested objects with unordered keys', () => {
    const a = { money: { currency: 'BRL', amount: '10.00' }, kind: 'BET' };
    const b = { kind: 'BET', money: { amount: '10.00', currency: 'BRL' } };
    expect(generateCanonicalPayloadHash(a)).toBe(generateCanonicalPayloadHash(b));
  });

  it('handles arrays (order matters within arrays)', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    expect(generateCanonicalPayloadHash(a)).not.toBe(generateCanonicalPayloadHash(b));
  });

  it('handles null values', () => {
    const a = { ref: null, kind: 'BET' };
    const b = { kind: 'BET', ref: null };
    expect(generateCanonicalPayloadHash(a)).toBe(generateCanonicalPayloadHash(b));
  });

  it('returns a 64-char hex SHA-256', () => {
    const hash = generateCanonicalPayloadHash({ foo: 'bar' });
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('same payload always produces the same hash (deterministic)', () => {
    const payload = {
      providerId: 'provider-a',
      externalTransactionId: 'tx-123',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };
    const h1 = generateCanonicalPayloadHash(payload);
    const h2 = generateCanonicalPayloadHash(payload);
    expect(h1).toBe(h2);
  });

  it('different payload (different field value) produces different hash', () => {
    const base = { providerId: 'p', kind: 'BET', money: { amount: '25.00', currency: 'BRL' } };
    const modified = { ...base, money: { amount: '25.00', currency: 'USD' } };
    expect(generateCanonicalPayloadHash(base)).not.toBe(generateCanonicalPayloadHash(modified));
  });
});
