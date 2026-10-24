/**
 * Integration test helpers — shared database setup.
 */
import { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletOrmEntity } from '../../../src/infrastructure/database/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../../src/infrastructure/database/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../../src/infrastructure/database/entities/wager-transaction.orm-entity.js';
import { InboxMessageOrmEntity } from '../../../src/infrastructure/database/entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from '../../../src/infrastructure/database/entities/outbox-message.orm-entity.js';

let orm: MikroORM | null = null;

export async function getTestOrm(): Promise<MikroORM> {
  if (orm) return orm;

  orm = await MikroORM.init(
    defineConfig({
      driver: PostgreSqlDriver,
      host: process.env['POSTGRES_HOST'] ?? 'postgres',
      port: Number(process.env['POSTGRES_PORT'] ?? 5432),
      dbName: process.env['POSTGRES_DB'] ?? 'wagering',
      user: process.env['POSTGRES_USER'] ?? 'wagering',
      password: process.env['POSTGRES_PASSWORD'] ?? 'wagering_secret',
      entities: [
        WalletOrmEntity,
        WalletLedgerEntryOrmEntity,
        WagerTransactionOrmEntity,
        InboxMessageOrmEntity,
        OutboxMessageOrmEntity,
      ],
      migrations: {
        pathTs: 'src/infrastructure/database/migrations',
        // Only pick up Migration*.ts — excludes run.ts and revert.ts
        glob: 'Migration*.{js,ts}',
        transactional: true,
        allOrNothing: true,
        snapshot: false,
      },
      extensions: [Migrator],
      debug: false,
    }),
  );

  // Run migrations on first connect
  await orm.getMigrator().up();

  return orm;
}

export async function getTestEm(): Promise<EntityManager> {
  const o = await getTestOrm();
  return o.em.fork();
}

/** Truncate all tables between tests for isolation. */
export async function cleanDatabase(em: EntityManager): Promise<void> {
  await em.getConnection().execute(`
    TRUNCATE TABLE
      outbox_messages,
      inbox_messages,
      wager_transactions,
      wallet_ledger_entries,
      wallets
    RESTART IDENTITY CASCADE
  `);
}

export async function closeTestOrm(): Promise<void> {
  if (orm) {
    await orm.close();
    orm = null;
  }
}
