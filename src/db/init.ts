import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db } from './index.js';
import { runMigrations } from './migrate.js';
import { DEFAULT_SETTINGS, ROLES } from '../utils/constants.js';
import { nowIso } from '../utils/dates.js';
import { log } from '../logger.js';

/** Applies schema migrations and reference data. Never inserts business/demo records. */
export async function migrate() {
  const applied = await runMigrations(db);
  if (applied.length) log.info('migrations applied', { applied });
  for (const r of ROLES) {
    await db.run('INSERT INTO roles (key, name, description) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', [r.key, r.name, r.description]);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const v = key === 'company' && config.companyName ? { ...(value as object), name: config.companyName } : value;
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [key, JSON.stringify(v)]);
  }
  // Settings objects gain fields over releases: fill in new defaults without touching saved values.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (Array.isArray(value) || typeof value !== 'object') continue;
    const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) continue;
    const saved = JSON.parse(row.value);
    const merged = { ...(value as object), ...saved };
    if (Object.keys(merged).length !== Object.keys(saved).length) await db.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(merged), key]);
  }
  return applied;
}

/** Production first run: create the first administrator from environment variables. */
export async function ensureAdmin() {
  const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
  if (count > 0) return;
  const { email, password, name } = config.bootstrapAdmin;
  if (!email || password.length < 8) {
    throw new Error(
      'The database has no users. Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 characters) in server/.env to create the first administrator.',
    );
  }
  await db.insert('users', {
    name,
    email,
    password_hash: bcrypt.hashSync(password, 10),
    role: 'admin',
    title: 'Administrator',
    status: 'Active',
    password_changed_at: nowIso(),
    created_at: nowIso(),
  });
  log.info('created first administrator', { email });
}

/** Refuses to run production against a database that contains demo data. */
export async function assertDatabaseMatchesMode() {
  // A brand-new database has no settings table yet, so there is nothing to check.
  const demoMarker = await db.get("SELECT value FROM settings WHERE key = '_demo_data'").catch(() => undefined);
  if (!config.isDemo && demoMarker) throw new Error(`${config.dbFile} contains demo data. Point DATABASE_FILE at your production database.`);
}
