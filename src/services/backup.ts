import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { log } from '../logger.js';
import { today } from '../utils/dates.js';

/**
 * Daily database backups on the server's own disk (no outside service). SQLite's VACUUM INTO writes a
 * consistent copy while the app keeps running. The newest KEEP copies are kept; uploads are not copied.
 */
const KEEP = 14;
export const backupDir = () => path.join(path.dirname(config.dbFile), 'backups');
const prefix = () => path.basename(config.dbFile, path.extname(config.dbFile));
export const BACKUP_NAME = /^[\w.-]+-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/;

export function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => BACKUP_NAME.test(f) && f.startsWith(prefix() + '-'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Writes a backup now. `manual` copies get a time suffix so several can be taken in one day. */
export async function createBackup(manual = false) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = manual ? `-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}` : '';
  const name = `${prefix()}-${today()}${stamp}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) fs.rmSync(file);
  await db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(dir, old.name), { force: true });
  log.info('database backup written', { file });
  return listBackups().find((b) => b.name === name)!;
}

/** Called by the scheduler: one automatic backup per day. */
export async function dailyBackupIfDue() {
  if (config.isTest) return false;
  const name = `${prefix()}-${today()}.db`;
  if (fs.existsSync(path.join(backupDir(), name))) return false;
  await createBackup(false);
  return true;
}
