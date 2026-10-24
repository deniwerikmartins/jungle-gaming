import { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessage } from '../../../domain/shared/events/inbox-message.js';
import { InboxMessageOrmEntity } from '../entities/inbox-message.orm-entity.js';
import { InboxMessageMapper } from '../entities/inbox-message.mapper.js';

export class InboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findByKey(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const orm = await this.em.findOne(InboxMessageOrmEntity, { consumerName, messageId });
    return orm ? InboxMessageMapper.toDomain(orm) : null;
  }

  async save(domain: InboxMessage): Promise<void> {
    const orm = InboxMessageMapper.toOrm(domain);
    this.em.persist(orm);
  }
}
