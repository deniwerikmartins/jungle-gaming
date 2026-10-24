/**
 * Revert last migration.
 * Usage: bun run src/infrastructure/database/migrations/revert.ts
 */
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config.js';

async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    await orm.getMigrator().down();
    console.log(JSON.stringify({ level: 'info', msg: 'Migration reverted.' }));
  } finally {
    await orm.close();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Revert failed', error: String(err) }));
  process.exit(1);
});
