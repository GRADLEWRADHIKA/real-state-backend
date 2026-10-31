import type { Migration } from './types.js';

/**
 * Failed sign-ins are counted per account and network address, so someone who only knows an email
 * address can lock it out from their own address but not from everyone else's. The users columns
 * failed_logins / locked_until become a summary of these rows for Users & roles.
 */
export const migration: Migration = {
  id: '007_login_failures',
  async up(db) {
    await db.exec(`
      CREATE TABLE login_failures (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip TEXT NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, ip)
      );
      CREATE INDEX idx_login_failures_updated ON login_failures(updated_at);
      UPDATE users SET failed_logins = 0, locked_until = NULL;
    `);
  },
};
