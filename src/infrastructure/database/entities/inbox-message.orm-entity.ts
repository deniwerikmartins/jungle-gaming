import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
} from '@mikro-orm/core';

/**
 * ORM entity for inbox_messages table.
 *
 * Deduplication key: (consumer_name, message_id) — composite PK in schema.
 */
@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'], name: 'uq_inbox_consumer_message' })
export class InboxMessageOrmEntity {
  @PrimaryKey({ fieldName: 'message_id', length: 255 })
  messageId!: string;

  @PrimaryKey({ fieldName: 'consumer_name', length: 255 })
  consumerName!: string;

  @Property({ fieldName: 'payload_hash', length: 64 })
  payloadHash!: string;

  @Property({ fieldName: 'received_at', columnType: 'timestamptz' })
  receivedAt!: Date;

  @Property({ fieldName: 'processed_at', columnType: 'timestamptz', nullable: true })
  @Index({ name: 'idx_inbox_processed_at' })
  processedAt?: Date;
}
