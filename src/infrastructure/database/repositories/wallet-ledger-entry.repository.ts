import { EntityManager } from '@mikro-orm/postgresql';
import { ref } from '@mikro-orm/core';
import { WalletLedgerEntry } from '../../../domain/wallet/entities/wallet-ledger-entry.js';
import { WalletLedgerEntryOrmEntity } from '../entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';
import { WalletLedgerEntryMapper } from '../entities/wallet-ledger-entry.mapper.js';

export interface LedgerPage {
  readonly items: WalletLedgerEntry[];
  readonly nextCursor: string | null;
}

export class WalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Returns paginated ledger entries for a wallet using a stable opaque cursor.
   * Cursor is base64-encoded ISO timestamp of the last entry seen.
   */
  async findByWalletPaginated(
    walletId: string,
    limit: number,
    cursor?: string,
  ): Promise<LedgerPage> {
    const where: Record<string, unknown> = { wallet: walletId };

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      where['createdAt'] = { $lt: new Date(decoded) };
    }

    const orms = await this.em.find(WalletLedgerEntryOrmEntity, where, {
      orderBy: { createdAt: 'DESC' },
      limit: limit + 1,
    });

    const hasMore = orms.length > limit;
    const items = hasMore ? orms.slice(0, limit) : orms;
    const lastItem = items[items.length - 1];

    const nextCursor =
      hasMore && lastItem
        ? Buffer.from(lastItem.createdAt.toISOString()).toString('base64')
        : null;

    return {
      items: items.map(WalletLedgerEntryMapper.toDomain),
      nextCursor,
    };
  }

  /**
   * Sums all ledger entries for reconciliation.
   * Returns the calculated balance as a string.
   */
  async calculateBalance(walletId: string): Promise<{ calculatedAmount: string; entryCount: number }> {
    const result = await this.em
      .getConnection()
      .execute<{ calculated_amount: string; entry_count: string }[]>(
        `SELECT
           COALESCE(
             SUM(CASE WHEN direction = 'CREDIT' THEN money_amount ELSE -money_amount END),
             0
           )::TEXT AS calculated_amount,
           COUNT(*)::TEXT AS entry_count
         FROM wallet_ledger_entries
         WHERE wallet_id = ?`,
        [walletId],
      );

    const row = result[0];
    return {
      calculatedAmount: row?.calculated_amount ?? '0.00',
      entryCount: Number(row?.entry_count ?? 0),
    };
  }

  async save(domain: WalletLedgerEntry, walletId: string): Promise<void> {
    const walletRef = this.em.getReference(WalletOrmEntity, walletId);
    const orm = WalletLedgerEntryMapper.toOrm(domain, walletRef);
    this.em.persist(orm);
  }
}
