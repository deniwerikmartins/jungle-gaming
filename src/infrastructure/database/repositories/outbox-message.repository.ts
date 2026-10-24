import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { OutboxMessage } from '../../../domain/shared/events/outbox-message.js';
import { OutboxMessageOrmEntity } from '../entities/outbox-message.orm-entity.js';
import { OutboxMessageMapper } from '../entities/outbox-message.mapper.js';

export class OutboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Returns unpublished messages due for processing.
   * Uses SKIP LOCKED so multiple workers can run concurrently without conflicts.
   */
  async findDuePending(limit = 10): Promise<OutboxMessage[]> {
    const orms = await this.em.find(
      OutboxMessageOrmEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
      },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL,
        limit,
        orderBy: { occurredAt: 'ASC' },
      },
    );
    return orms.map(OutboxMessageMapper.toDomain);
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    const orm = await this.em.findOne(OutboxMessageOrmEntity, { id });
    return orm ? OutboxMessageMapper.toDomain(orm) : null;
  }

  async save(domain: OutboxMessage): Promise<void> {
    const existing = await this.em.findOne(OutboxMessageOrmEntity, { id: domain.id });
    const orm = OutboxMessageMapper.toOrm(domain, existing ?? undefined);
    if (!existing) {
      this.em.persist(orm);
    } else {
      // Update mutable fields on tracked entity
      existing.attempts = domain.attempts;
      existing.nextAttemptAt = domain.nextAttemptAt;
      existing.publishedAt = domain.publishedAt;
    }
  }
}
