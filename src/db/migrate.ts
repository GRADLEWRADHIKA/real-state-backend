import type { Db } from './adapter.js';
import { MIGRATIONS } from './migrations/index.js';
import { nowIso } from '../utils/dates.js';

/** Applies pending migrations in order, each in its own transaction. Returns the ids applied. */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.all<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async () => {
      await m.up(db);
      await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, nowIso()]);
    });
    applied.push(m.id);
  }
  return applied;
}
