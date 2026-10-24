import { Wallet } from '../../../domain/wallet/entities/wallet.js';
import { WalletOrmEntity } from './wallet.orm-entity.js';

export class WalletMapper {
  static toDomain(orm: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: orm.id,
      playerId: orm.playerId,
      currency: orm.currency,
      balanceAmount: orm.balanceAmount,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: Wallet, existing?: WalletOrmEntity): WalletOrmEntity {
    const orm = existing ?? new WalletOrmEntity();
    orm.id = domain.id;
    orm.playerId = domain.playerId;
    orm.currency = domain.currency;
    orm.balanceAmount = domain.balance.toString();
    orm.version = domain.version;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
