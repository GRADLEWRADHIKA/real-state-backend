import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { log } from '../logger.js';
import { today } from '../utils/dates.js';

/**
 * Daily database backups on the server's own disk (no outside service). SQLite's VACUUM INTO writes a
 * consistent copy while the app keeps running. The newest KEEP_DAILY automatic copies and KEEP_MANUAL
 * "Back up now" copies are kept separately, so manual copies never push out the daily ones. Uploaded
 * files are mirrored into backups/<database>-uploads with each backup (demo and production keep separate
 * mirrors): new and changed files are copied and nothing is ever removed from the mirror, so a document
 * deleted in the app can still be recovered.
 */
const KEEP_DAILY = 14;
const KEEP_MANUAL = 10;
const isManual = (name: string) => /-\d{6}\.db$/.test(name);

export const backupDir = () => path.join(path.dirname(config.dbFile), 'backups');
const prefix = () => path.basename(config.dbFile, path.extname(config.dbFile));
export const uploadsMirrorDir = () => path.join(backupDir(), `${prefix()}-uploads`);
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
  const all = listBackups();
  const old = [...all.filter((b) => !isManual(b.name)).slice(KEEP_DAILY), ...all.filter((b) => isManual(b.name)).slice(KEEP_MANUAL)];
  for (const b of old) fs.rmSync(path.join(dir, b.name), { force: true });
  const files = mirrorUploads();
  log.info('database backup written', { file, uploads_copied: files });
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

/** Copies new and changed upload files into the mirror. Returns how many files were copied. */
export function mirrorUploads(from = config.uploadDir, to = uploadsMirrorDir()): number {
  if (!fs.existsSync(from)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += mirrorUploads(src, dest);
    } else if (entry.isFile()) {
      const st = fs.statSync(src);
      const prev = fs.existsSync(dest) ? fs.statSync(dest) : null;
      if (prev && prev.size === st.size && prev.mtimeMs >= st.mtimeMs) continue;
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dest);
      fs.utimesSync(dest, st.atime, st.mtime);
      copied++;
    }
  }
  return copied;
}
