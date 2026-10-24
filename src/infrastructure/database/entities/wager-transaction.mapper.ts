import { WagerTransaction } from '../../../domain/wagering/entities/wager-transaction.js';
import { WagerTransactionOrmEntity } from './wager-transaction.orm-entity.js';
import { WalletOrmEntity } from './wallet.orm-entity.js';

export class WagerTransactionMapper {
  static toDomain(orm: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: orm.id,
      providerId: orm.providerId,
      externalTransactionId: orm.externalTransactionId,
      idempotencyKey: orm.idempotencyKey,
      payloadHash: orm.payloadHash,
      walletId: orm.wallet.id,
      playerId: orm.playerId,
      roundId: orm.roundId,
      gameId: orm.gameId,
      kind: orm.kind,
      moneyAmount: orm.moneyAmount,
      moneyCurrency: orm.moneyCurrency,
      referenceExternalTransactionId: orm.referenceExternalTransactionId,
      referenceTransactionId: orm.referenceTransactionId,
      status: orm.status,
      failureCode: orm.failureCode,
      processedAt: orm.processedAt,
      createdAt: orm.createdAt,
    });
  }

  static toOrm(
    domain: WagerTransaction,
    walletRef: WalletOrmEntity,
    existing?: WagerTransactionOrmEntity,
  ): WagerTransactionOrmEntity {
    const orm = existing ?? new WagerTransactionOrmEntity();
    orm.id = domain.id;
    orm.providerId = domain.providerId;
    orm.externalTransactionId = domain.externalTransactionId;
    orm.idempotencyKey = domain.idempotencyKey;
    orm.payloadHash = domain.payloadHash;
    orm.wallet = walletRef;
    orm.playerId = domain.playerId;
    orm.roundId = domain.roundId;
    orm.gameId = domain.gameId;
    orm.kind = domain.kind;
    orm.moneyAmount = domain.money.toString();
    orm.moneyCurrency = domain.money.currency;
    orm.referenceExternalTransactionId = domain.referenceExternalTransactionId;
    orm.referenceTransactionId = domain.referenceTransactionId;
    orm.status = domain.status;
    orm.failureCode = domain.failureCode;
    orm.processedAt = domain.processedAt;
    orm.createdAt = domain.createdAt;
    return orm;
  }
}
