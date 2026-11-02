import type { Migration } from './types.js';

/**
 * A rate set for a future date with "re-price unsold units" ticked waits in price_list.apply_pending
 * until its date comes; the scheduler then re-prices the units, if it is still the rate in effect.
 */
export const migration: Migration = {
  id: '008_price_list_pending',
  async up(db) {
    await db.exec(`
      ALTER TABLE price_list ADD COLUMN apply_pending INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_price_list_pending ON price_list(apply_pending, effective_from);
    `);
  },
};
