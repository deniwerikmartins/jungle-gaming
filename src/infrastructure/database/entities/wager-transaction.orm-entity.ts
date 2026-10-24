import {
  Entity,
  PrimaryKey,
  Property,
  Enum,
  Index,
  Unique,
  ManyToOne,
} from '@mikro-orm/core';
import { WalletOrmEntity } from './wallet.orm-entity.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/entities/wager-transaction.enums.js';
import { FailureCode } from '../../../domain/shared/value-objects/failure-code.js';

/**
 * ORM entity for wager_transactions table.
 *
 * Constraints:
 * - UNIQUE (idempotency_key)  — one result per idempotency key
 */
@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'], name: 'uq_wager_transactions_idempotency_key' })
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: 'uuid', columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'provider_id', length: 255 })
  @Index({ name: 'idx_wager_provider_id' })
  providerId!: string;

  @Property({ fieldName: 'external_transaction_id', length: 255 })
  externalTransactionId!: string;

  @Unique({ name: 'uq_wager_idempotency_key' })
  @Property({ fieldName: 'idempotency_key', length: 512 })
  idempotencyKey!: string;

  @Property({ fieldName: 'payload_hash', length: 64 })
  payloadHash!: string;

  @ManyToOne(() => WalletOrmEntity, { fieldName: 'wallet_id', columnType: 'uuid' })
  @Index({ name: 'idx_wager_wallet_id' })
  wallet!: WalletOrmEntity;

  @Property({ fieldName: 'wallet_id', persist: false })
  get walletId(): string {
    return this.wallet.id;
  }

  @Property({ fieldName: 'player_id', columnType: 'uuid' })
  @Index({ name: 'idx_wager_player_id' })
  playerId!: string;

  @Property({ fieldName: 'round_id', length: 255 })
  @Index({ name: 'idx_wager_round_id' })
  roundId!: string;

  @Property({ fieldName: 'game_id', length: 255 })
  gameId!: string;

  @Enum({ items: () => WagerTransactionKind, fieldName: 'kind' })
  kind!: WagerTransactionKind;

  @Property({ fieldName: 'money_amount', columnType: 'numeric(20,2)' })
  moneyAmount!: string;

  @Property({ fieldName: 'money_currency', length: 3 })
  moneyCurrency!: string;

  @Property({ fieldName: 'reference_external_transaction_id', length: 255, nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ fieldName: 'reference_transaction_id', columnType: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Enum({ items: () => WagerTransactionStatus, fieldName: 'status' })
  @Index({ name: 'idx_wager_status' })
  status!: WagerTransactionStatus;

  @Enum({ items: () => FailureCode, fieldName: 'failure_code', nullable: true })
  failureCode?: FailureCode;

  @Property({ fieldName: 'processed_at', columnType: 'timestamptz', nullable: true })
  processedAt?: Date;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  @Index({ name: 'idx_wager_created_at' })
  createdAt!: Date;
}
