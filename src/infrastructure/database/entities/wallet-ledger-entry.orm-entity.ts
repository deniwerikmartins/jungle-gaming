import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Index,
  Enum,
  Ref,
  ref,
} from '@mikro-orm/core';
import { WalletOrmEntity } from './wallet.orm-entity.js';
import { LedgerDirection } from '../../../domain/wallet/entities/ledger-direction.enum.js';

/**
 * ORM entity for wallet_ledger_entries table.
 * Immutable by design: no update endpoints, no setters, write-once via INSERT.
 */
@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: 'uuid', columnType: 'uuid' })
  id!: string;

  @ManyToOne(() => WalletOrmEntity, { fieldName: 'wallet_id', columnType: 'uuid', ref: true })
  @Index({ name: 'idx_ledger_wallet_id' })
  wallet!: Ref<WalletOrmEntity>;

  @Property({ fieldName: 'transaction_id', columnType: 'uuid' })
  @Index({ name: 'idx_ledger_transaction_id' })
  transactionId!: string;

  @Enum({ items: () => LedgerDirection, fieldName: 'direction' })
  direction!: LedgerDirection;

  @Property({ fieldName: 'money_amount', columnType: 'numeric(20,2)' })
  moneyAmount!: string;

  @Property({ fieldName: 'money_currency', length: 3 })
  moneyCurrency!: string;

  @Property({ fieldName: 'balance_before_amount', columnType: 'numeric(20,2)' })
  balanceBeforeAmount!: string;

  @Property({ fieldName: 'balance_after_amount', columnType: 'numeric(20,2)' })
  balanceAfterAmount!: string;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  createdAt!: Date;
}
