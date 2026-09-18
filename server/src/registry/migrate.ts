import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function runMigrations(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await migrate(drizzle(pool), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle') });
  await pool.end();
}
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) runMigrations(process.env.DATABASE_URL!).then(() => console.log('migrated'));
