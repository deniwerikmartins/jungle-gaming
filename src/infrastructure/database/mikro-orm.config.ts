import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletOrmEntity } from './entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from './entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from './entities/wager-transaction.orm-entity.js';
import { InboxMessageOrmEntity } from './entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from './entities/outbox-message.orm-entity.js';

export default defineConfig({
  driver: PostgreSqlDriver,
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
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
    // Only pick up files that follow the Migration naming convention
    glob: 'Migration*.{js,ts}',
    transactional: true,
    allOrNothing: true,
    snapshot: false,
  },

  extensions: [Migrator],

  pool: { min: 2, max: 20 },
  flushMode: 1, // FlushMode.COMMIT

  debug: process.env['NODE_ENV'] === 'development',

  logger: (msg) => {
    if (process.env['NODE_ENV'] !== 'test') {
      process.stdout.write(JSON.stringify({ level: 'debug', msg }) + '\n');
    }
  },
});
