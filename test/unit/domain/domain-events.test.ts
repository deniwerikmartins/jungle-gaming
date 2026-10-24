import { describe, expect, it } from 'bun:test';
import { v4 as uuidv4 } from 'uuid';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from '../../../src/domain/shared/events/domain-events.js';
import { LedgerDirection } from '../../../src/domain/wallet/entities/ledger-direction.enum.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/entities/wager-transaction.enums.js';
import { FailureCode } from '../../../src/domain/shared/value-objects/failure-code.js';
import { OutboxMessage } from '../../../src/domain/shared/events/outbox-message.js';

describe('WalletBalanceChanged', () => {
  it('creates event with correct fields via from()', () => {
    const event = WalletBalanceChanged.from(
      'wallet-1',
      'tx-1',
      LedgerDirection.Debit,
      { amount: '80.00', currency: 'BRL' },
      { amount: '100.00', currency: 'BRL' },
      { amount: '20.00', currency: 'BRL' },
      1,
      'corr-1',
    );

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('wallet-1');
    expect(event.data.direction).toBe(LedgerDirection.Debit);
    expect(event.data.balanceBefore.amount).toBe('100.00');
    expect(event.data.balanceAfter.amount).toBe('20.00');
  });

  it('toJSON produces stable, serializable output', () => {
    const event = WalletBalanceChanged.from(
      'wallet-1', 'tx-1', LedgerDirection.Credit,
      { amount: '50.00', currency: 'BRL' },
      { amount: '0.00', currency: 'BRL' },
      { amount: '50.00', currency: 'BRL' },
      1, 'corr-1',
    );

    const json = event.toJSON();
    expect(json.eventType).toBe('WalletBalanceChanged');
    expect(typeof json.occurredAt).toBe('string');
    expect(json.data.money.amount).toBe('50.00');
  });
});

describe('WagerTransactionProcessed', () => {
  it('creates event with correct eventType', () => {
    const event = new WagerTransactionProcessed({
      eventId: uuidv4(),
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: new Date(),
      data: {
        transactionId: 'tx-1',
        walletId: 'w-1',
        playerId: 'p-1',
        providerId: 'prov-1',
        externalTransactionId: 'ext-1',
        kind: 'BET',
        status: WagerTransactionStatus.Processed,
        money: { amount: '25.00', currency: 'BRL' },
        idempotentReplay: false,
      },
    });
    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.data.status).toBe(WagerTransactionStatus.Processed);
  });
});

describe('WagerTransactionRejected', () => {
  it('creates event with failureCode', () => {
    const event = new WagerTransactionRejected({
      eventId: uuidv4(),
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: new Date(),
      data: {
        transactionId: 'tx-1',
        walletId: 'w-1',
        playerId: 'p-1',
        providerId: 'prov-1',
        externalTransactionId: 'ext-1',
        kind: 'BET',
        failureCode: FailureCode.InsufficientFunds,
        money: { amount: '80.00', currency: 'BRL' },
      },
    });
    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.data.failureCode).toBe(FailureCode.InsufficientFunds);
  });
});

describe('WagerTransactionPendingReference', () => {
  it('creates event with referenceExternalTransactionId', () => {
    const event = new WagerTransactionPendingReference({
      eventId: uuidv4(),
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: new Date(),
      data: {
        transactionId: 'tx-1',
        walletId: 'w-1',
        providerId: 'prov-1',
        externalTransactionId: 'ext-1',
        referenceExternalTransactionId: 'ext-bet-1',
        kind: 'REFUND',
      },
    });
    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.data.referenceExternalTransactionId).toBe('ext-bet-1');
  });
});

describe('OutboxMessage.enqueue from domain events', () => {
  it('enqueues a WalletBalanceChanged event correctly', () => {
    const event = WalletBalanceChanged.from(
      'wallet-1', 'tx-1', LedgerDirection.Debit,
      { amount: '80.00', currency: 'BRL' },
      { amount: '100.00', currency: 'BRL' },
      { amount: '20.00', currency: 'BRL' },
      1, 'corr-1',
    );

    const msg = OutboxMessage.enqueue(event as any);
    expect(msg.eventType).toBe('WalletBalanceChanged');
    expect(msg.aggregateId).toBe('wallet-1');
    expect(msg.isPending()).toBe(true);
    expect(msg.attempts).toBe(0);

    const payload = msg.payload as any;
    expect(payload.eventType).toBe('WalletBalanceChanged');
    expect(payload.data.direction).toBe(LedgerDirection.Debit);
  });
});
