/**
 * Database adapter.
 *
 * Every query in the application goes through this async interface, so SQLite can be
 * swapped for PostgreSQL/MySQL by providing another implementation of `Db` (e.g. with `pg`):
 * placeholders stay `?` (convert to `$n` inside the adapter), inserts use `insert()` so the
 * driver decides how to return the new id, and dialect-specific SQL lives in `dialect`.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, any>;

export interface Db {
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId: number }>;
  insert(table: string, data: Row): Promise<number>;
  update(table: string, id: number, data: Row): Promise<number>;
  exec(sql: string): Promise<void>;
  /** Runs `fn` atomically. Nested calls become savepoints. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
  dialect: {
    /** Expression yielding 'YYYY-MM' for a date/datetime column. */
    month(column: string): string;
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function normalize(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

/**
 * Node's built-in SQLite (node:sqlite, Node 22.13+) needs no native compile, so the API installs on any
 * machine without build tools. Loading it prints a one-time "experimental" notice, which is muted here.
 */
function loadSqlite(): { DatabaseSync: typeof DatabaseSync } {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
    if (String(typeof warning === 'string' ? warning : warning.message).includes('SQLite')) return;
    return (emit as any).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
}

export function createSqliteDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA busy_timeout = 5000');

  let depth = 0;
  const params = (p: unknown[] = []) => p.map(normalize);

  const db: Db = {
    async all(sql, p) {
      return conn.prepare(sql).all(...(params(p) as any[])) as any[];
    },
    async get(sql, p) {
      return conn.prepare(sql).get(...(params(p) as any[])) as any;
    },
    async run(sql, p) {
      const r = conn.prepare(sql).run(...(params(p) as any[]));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async insert(table, data) {
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      if (!IDENT.test(table) || !keys.every((k) => IDENT.test(k))) throw new Error('Invalid identifier');
      const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
      const r = conn.prepare(sql).run(...(params(keys.map((k) => data[k])) as any[]));
      return Number(r.lastInsertRowid);
    },
    async update(table, id, data) {
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      if (!keys.length) return 0;
      if (!IDENT.test(table) || !keys.every((k) => IDENT.test(k))) throw new Error('Invalid identifier');
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      return Number(conn.prepare(sql).run(...(params([...keys.map((k) => data[k]), id]) as any[])).changes);
    },
    async exec(sql) {
      conn.exec(sql);
    },
    // node:sqlite is synchronous, so the callback runs to completion without other
    // requests interleaving as long as it only awaits db calls (no network/file I/O inside).
    async transaction(fn) {
      const sp = `sp_${depth}`;
      conn.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const result = await fn();
        depth--;
        conn.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return result;
      } catch (err) {
        depth--;
        conn.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    },
    close() {
      conn.close();
    },
    dialect: {
      month: (column) => `substr(${column}, 1, 7)`,
    },
  };
  return db;
}
