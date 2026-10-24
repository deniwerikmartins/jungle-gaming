import { OutboxMessage } from '../../../domain/shared/events/outbox-message.js';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity.js';

export class OutboxMessageMapper {
  static toDomain(orm: OutboxMessageOrmEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: orm.id,
      aggregateId: orm.aggregateId,
      eventType: orm.eventType,
      payload: orm.payload,
      occurredAt: orm.occurredAt,
      attempts: orm.attempts,
      nextAttemptAt: orm.nextAttemptAt,
      publishedAt: orm.publishedAt,
    });
  }

  static toOrm(domain: OutboxMessage, existing?: OutboxMessageOrmEntity): OutboxMessageOrmEntity {
    const orm = existing ?? new OutboxMessageOrmEntity();
    orm.id = domain.id;
    orm.aggregateId = domain.aggregateId;
    orm.eventType = domain.eventType;
    orm.payload = domain.payload as Record<string, unknown>;
    orm.occurredAt = domain.occurredAt;
    orm.attempts = domain.attempts;
    orm.nextAttemptAt = domain.nextAttemptAt;
    orm.publishedAt = domain.publishedAt;
    return orm;
  }
}
