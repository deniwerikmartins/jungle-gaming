import { InboxMessage } from '../../../domain/shared/events/inbox-message.js';
import { InboxMessageOrmEntity } from './inbox-message.orm-entity.js';

export class InboxMessageMapper {
  static toDomain(orm: InboxMessageOrmEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: orm.messageId,
      consumerName: orm.consumerName,
      payloadHash: orm.payloadHash,
      receivedAt: orm.receivedAt,
      processedAt: orm.processedAt,
    });
  }

  static toOrm(domain: InboxMessage): InboxMessageOrmEntity {
    const orm = new InboxMessageOrmEntity();
    orm.messageId = domain.messageId;
    orm.consumerName = domain.consumerName;
    orm.payloadHash = domain.payloadHash;
    orm.receivedAt = domain.receivedAt;
    orm.processedAt = domain.processedAt;
    return orm;
  }
}
