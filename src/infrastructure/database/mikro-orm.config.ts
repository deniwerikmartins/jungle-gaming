import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

export default defineConfig({
  driver: PostgreSqlDriver,
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: Number(process.env['POSTGRES_PORT'] ?? 5432),
  dbName: process.env['POSTGRES_DB'] ?? 'wagering',
  user: process.env['POSTGRES_USER'] ?? 'wagering',
  password: process.env['POSTGRES_PASSWORD'] ?? 'wagering_secret',

  // Entities from infrastructure layer only — domain is ORM-free
  entities: ['dist/infrastructure/database/entities/*.js'],
  entitiesTs: ['src/infrastructure/database/entities/*.ts'],

  metadataProvider: TsMorphMetadataProvider,

  migrations: {
    path: 'dist/infrastructure/database/migrations',
    pathTs: 'src/infrastructure/database/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
    snapshot: false,
  },

  extensions: [Migrator],

  // Connection pool tuned for concurrent load
  pool: {
    min: 2,
    max: 20,
  },

  // Disable auto-flush — explicit control in use cases
  flushMode: 1, // FlushMode.COMMIT

  debug: process.env['NODE_ENV'] === 'development',

  // Structured logging
  logger: (msg) => {
    if (process.env['NODE_ENV'] !== 'test') {
      process.stdout.write(JSON.stringify({ level: 'debug', msg }) + '\n');
    }
  },
});
