import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Check,
  Unique,
  OneToMany,
  Collection,
} from '@mikro-orm/core';
import { WalletLedgerEntryOrmEntity } from './wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from './wager-transaction.orm-entity.js';

/**
 * ORM entity for wallets table.
 *
 * Constraints enforced in schema (not just application code):
 * - UNIQUE (player_id, currency)     — one wallet per player per currency
 * - CHECK (balance_amount >= 0)      — non-negative balance invariant
 */
@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'], name: 'uq_wallets_player_currency' })
@Check({ name: 'chk_wallets_balance_non_negative', expression: 'balance_amount >= 0' })
export class WalletOrmEntity {
  @PrimaryKey({ type: 'uuid', columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'player_id', columnType: 'uuid' })
  @Index({ name: 'idx_wallets_player_id' })
  playerId!: string;

  @Property({ fieldName: 'currency', length: 3 })
  currency!: string;

  /**
   * Stored as NUMERIC(20, 2) — exact decimal, never float.
   * Mapped as string in/out to preserve precision without JS number conversion.
   */
  @Property({ fieldName: 'balance_amount', columnType: 'numeric(20,2)' })
  balanceAmount!: string;

  @Property({ fieldName: 'version', columnType: 'integer', default: 0 })
  version!: number;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({
    fieldName: 'updated_at',
    columnType: 'timestamptz',
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;

  @OneToMany(() => WalletLedgerEntryOrmEntity, (e) => e.wallet)
  ledgerEntries = new Collection<WalletLedgerEntryOrmEntity>(this);

  @OneToMany(() => WagerTransactionOrmEntity, (e) => e.wallet)
  transactions = new Collection<WagerTransactionOrmEntity>(this);
}
