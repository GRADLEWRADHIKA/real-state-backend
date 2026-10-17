import type { Migration } from './types.js';

export const migration: Migration = {
  id: '002_auth_security',
  async up(db) {
    await db.exec(`
      ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN locked_until TEXT;
      ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN password_changed_at TEXT;

      CREATE TABLE refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        family TEXT NOT NULL,
        client TEXT NOT NULL,
        device TEXT,
        ip TEXT,
        remember INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        replaced_by INTEGER
      );
      CREATE INDEX idx_refresh_user ON refresh_tokens(user_id, revoked_at);
      CREATE INDEX idx_refresh_family ON refresh_tokens(family);

      CREATE TABLE password_reset_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        note TEXT,
        ip TEXT,
        status TEXT NOT NULL DEFAULT 'Pending',
        code_hash TEXT,
        code_expires_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        issued_at TEXT,
        completed_at TEXT,
        requested_at TEXT NOT NULL
      );
      CREATE INDEX idx_reset_user ON password_reset_requests(user_id, status);

      -- Receipt numbers come from a per-financial-year counter, never from COUNT(*).
      CREATE TABLE receipt_sequences (
        fy TEXT PRIMARY KEY,
        last_number INTEGER NOT NULL
      );

      ALTER TABLE activities ADD COLUMN action TEXT;
      ALTER TABLE activities ADD COLUMN entity_type TEXT;
      ALTER TABLE activities ADD COLUMN entity_id INTEGER;
      ALTER TABLE activities ADD COLUMN ip TEXT;
      ALTER TABLE activities ADD COLUMN request_id TEXT;
      CREATE INDEX idx_activities_type ON activities(type, created_at);
      CREATE INDEX idx_activities_user ON activities(user_id, created_at);
    `);

    // Seed the counters from receipts that already exist (prefix/FY/NNNN).
    const rows = await db.all<{ receipt_number: string }>('SELECT receipt_number FROM transactions WHERE receipt_number IS NOT NULL');
    const max = new Map<string, number>();
    for (const r of rows) {
      const m = /\/(\d{4}-\d{2})\/(\d+)$/.exec(r.receipt_number);
      if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
    }
    for (const [fy, n] of max) await db.run('INSERT INTO receipt_sequences (fy, last_number) VALUES (?, ?)', [fy, n]);
  },
};
