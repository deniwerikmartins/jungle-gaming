import {
  Entity,
  PrimaryKey,
  Property,
  Index,
} from '@mikro-orm/core';

/**
 * ORM entity for outbox_messages table.
 * Worker polls: WHERE published_at IS NULL AND next_attempt_at <= NOW()
 */
@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageOrmEntity {
  @PrimaryKey({ type: 'uuid', columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'aggregate_id', columnType: 'uuid' })
  @Index({ name: 'idx_outbox_aggregate_id' })
  aggregateId!: string;

  @Property({ fieldName: 'event_type', length: 255 })
  @Index({ name: 'idx_outbox_event_type' })
  eventType!: string;

  @Property({ fieldName: 'payload', columnType: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at', columnType: 'timestamptz' })
  occurredAt!: Date;

  @Property({ fieldName: 'attempts', columnType: 'integer', default: 0 })
  attempts!: number;

  @Property({ fieldName: 'next_attempt_at', columnType: 'timestamptz', nullable: true })
  @Index({ name: 'idx_outbox_next_attempt_at' })
  nextAttemptAt?: Date;

  @Property({ fieldName: 'published_at', columnType: 'timestamptz', nullable: true })
  @Index({ name: 'idx_outbox_published_at' })
  publishedAt?: Date;
}
