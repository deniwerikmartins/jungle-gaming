/**
 * Integration test helpers — shared database setup.
 *
 * Uses the same MikroORM config as the application, pointed at a real
 * PostgreSQL instance (running in Docker Compose).
 */
import { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

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
      entities: ['src/infrastructure/database/entities/*.ts'],
      entitiesTs: ['src/infrastructure/database/entities/*.ts'],
      metadataProvider: TsMorphMetadataProvider,
      migrations: {
        pathTs: 'src/infrastructure/database/migrations',
        glob: '!(*.d).{js,ts}',
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
