import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransaction } from '../../../domain/wagering/entities/wager-transaction.js';
import { WagerTransactionStatus } from '../../../domain/wagering/entities/wager-transaction.enums.js';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.orm-entity.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';
import { WagerTransactionMapper } from '../entities/wager-transaction.mapper.js';

export interface LedgerPage {
  readonly items: WagerTransaction[];
  readonly nextCursor: string | null;
}

export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(WagerTransactionOrmEntity, { id }, { populate: ['wallet'] });
    return orm ? WagerTransactionMapper.toDomain(orm) : null;
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(
      WagerTransactionOrmEntity,
      { idempotencyKey: key },
      { populate: ['wallet'] },
    );
    return orm ? WagerTransactionMapper.toDomain(orm) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(
      WagerTransactionOrmEntity,
      { providerId, externalTransactionId },
      { populate: ['wallet'] },
    );
    return orm ? WagerTransactionMapper.toDomain(orm) : null;
  }

  /** Finds pending-reference transactions for the retry worker. */
  async findPendingReference(limit = 50): Promise<WagerTransaction[]> {
    const orms = await this.em.find(
      WagerTransactionOrmEntity,
      { status: WagerTransactionStatus.PendingReference },
      { populate: ['wallet'], limit, orderBy: { createdAt: 'ASC' } },
    );
    return orms.map(WagerTransactionMapper.toDomain);
  }

  async save(domain: WagerTransaction, walletId: string): Promise<void> {
    const walletRef = this.em.getReference(WalletOrmEntity, walletId);
    const existing = await this.em.findOne(WagerTransactionOrmEntity, { id: domain.id });
    const orm = WagerTransactionMapper.toOrm(domain, walletRef, existing ?? undefined);
    if (!existing) {
      this.em.persist(orm);
    }
  }
}
