import type { Db } from '../adapter.js';

export interface Migration {
  /** Sortable, unique and never renamed once released (NNN_description). */
  id: string;
  up(db: Db): Promise<void>;
}
