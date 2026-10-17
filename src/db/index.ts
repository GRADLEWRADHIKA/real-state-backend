import { config } from '../config.js';
import { createSqliteDb, type Db } from './adapter.js';

export const db: Db = createSqliteDb(config.dbFile);
export type { Db, Row } from './adapter.js';
