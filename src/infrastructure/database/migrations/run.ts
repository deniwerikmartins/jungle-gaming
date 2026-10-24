/**
 * Standalone migration runner — called by entrypoint.sh before app start.
 * Usage: bun run src/infrastructure/database/migrations/run.ts
 */
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config.js';

async function main(): Promise<void> {
  console.log(JSON.stringify({ level: 'info', msg: 'Running database migrations...' }));

  const orm = await MikroORM.init(config);
  const migrator = orm.getMigrator();

  try {
    const pending = await migrator.getPendingMigrations();
    if (pending.length === 0) {
      console.log(JSON.stringify({ level: 'info', msg: 'No pending migrations.' }));
    } else {
      console.log(
        JSON.stringify({ level: 'info', msg: `Applying ${pending.length} migration(s)...` }),
      );
      await migrator.up();
      console.log(JSON.stringify({ level: 'info', msg: 'Migrations completed successfully.' }));
    }
  } finally {
    await orm.close();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Migration failed', error: String(err) }));
  process.exit(1);
});
