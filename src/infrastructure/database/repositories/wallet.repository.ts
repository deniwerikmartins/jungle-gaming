import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Wallet } from '../../../domain/wallet/entities/wallet.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';
import { WalletMapper } from '../entities/wallet.mapper.js';

export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Finds a wallet by ID with pessimistic lock (SELECT FOR UPDATE).
   * MUST be called inside an active transaction.
   */
  async findByIdForUpdate(walletId: string): Promise<Wallet | null> {
    const orm = await this.em.findOne(
      WalletOrmEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return orm ? WalletMapper.toDomain(orm) : null;
  }

  /** Finds a wallet by ID without lock (for reads). */
  async findById(walletId: string): Promise<Wallet | null> {
    const orm = await this.em.findOne(WalletOrmEntity, { id: walletId });
    return orm ? WalletMapper.toDomain(orm) : null;
  }

  /** Finds a wallet by playerId + currency (no lock). */
  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const orm = await this.em.findOne(WalletOrmEntity, { playerId, currency });
    return orm ? WalletMapper.toDomain(orm) : null;
  }

  /** Persists a new or updated wallet. */
  async save(domain: Wallet): Promise<void> {
    const existing = await this.em.findOne(WalletOrmEntity, { id: domain.id });
    const orm = WalletMapper.toOrm(domain, existing ?? undefined);
    if (!existing) {
      this.em.persist(orm);
    }
    // If existing, fields are already updated on the tracked entity
  }
}
