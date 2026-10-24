import { WalletLedgerEntry } from '../../../domain/wallet/entities/wallet-ledger-entry.js';
import { WalletLedgerEntryOrmEntity } from './wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from './wallet.orm-entity.js';

export class WalletLedgerEntryMapper {
  static toDomain(orm: WalletLedgerEntryOrmEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: orm.id,
      walletId: orm.wallet.id,
      transactionId: orm.transactionId,
      direction: orm.direction,
      moneyAmount: orm.moneyAmount,
      moneyCurrency: orm.moneyCurrency,
      balanceBeforeAmount: orm.balanceBeforeAmount,
      balanceAfterAmount: orm.balanceAfterAmount,
      currency: orm.moneyCurrency,
      createdAt: orm.createdAt,
    });
  }

  static toOrm(
    domain: WalletLedgerEntry,
    walletRef: WalletOrmEntity,
  ): WalletLedgerEntryOrmEntity {
    const orm = new WalletLedgerEntryOrmEntity();
    orm.id = domain.id;
    orm.wallet = walletRef;
    orm.transactionId = domain.transactionId;
    orm.direction = domain.direction;
    orm.moneyAmount = domain.money.toString();
    orm.moneyCurrency = domain.money.currency;
    orm.balanceBeforeAmount = domain.balanceBefore.toString();
    orm.balanceAfterAmount = domain.balanceAfter.toString();
    orm.createdAt = domain.createdAt;
    return orm;
  }
}
