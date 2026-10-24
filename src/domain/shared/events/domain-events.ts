import { v4 as uuidv4 } from 'uuid';
import { IntegrationEvent, type IntegrationEventProps } from './integration-event.js';
import { LedgerDirection } from '../../wallet/entities/ledger-direction.enum.js';
import type { MoneyProps } from '../value-objects/money.js';
import type { WagerTransactionStatus } from '../../wagering/entities/wager-transaction.enums.js';
import type { FailureCode } from '../value-objects/failure-code.js';

// ---------------------------------------------------------------------------
// WalletBalanceChanged
// ---------------------------------------------------------------------------
export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }

  static from(
    walletId: string,
    transactionId: string,
    direction: LedgerDirection,
    money: MoneyProps,
    balanceBefore: MoneyProps,
    balanceAfter: MoneyProps,
    walletVersion: number,
    correlationId: string,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: uuidv4(),
      aggregateId: walletId,
      correlationId,
      occurredAt: new Date(),
      data: { walletId, transactionId, direction, money, balanceBefore, balanceAfter, walletVersion },
    });
  }
}

// ---------------------------------------------------------------------------
// WagerTransactionProcessed
// ---------------------------------------------------------------------------
export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  status: WagerTransactionStatus;
  money: MoneyProps;
  idempotentReplay: boolean;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }
}

// ---------------------------------------------------------------------------
// WagerTransactionRejected
// ---------------------------------------------------------------------------
export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  failureCode: FailureCode;
  money: MoneyProps;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}

// ---------------------------------------------------------------------------
// WagerTransactionPendingReference
// ---------------------------------------------------------------------------
export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId: string;
  kind: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }
}
