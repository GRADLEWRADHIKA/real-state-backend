import type { Migration } from './types.js';

/**
 * Sales tools: plot holds that expire, a price list per project and block with its history,
 * refunds on cancelled bookings, feedback after site visits and possession, and customer referrals.
 * Lead ageing and scores are worked out from existing columns, so they need no table.
 */
export const migration: Migration = {
  id: '006_sales_tools',
  async up(db) {
    await db.exec(`
      ALTER TABLE properties ADD COLUMN hold_until TEXT;
      ALTER TABLE properties ADD COLUMN hold_by INTEGER REFERENCES users(id);
      ALTER TABLE properties ADD COLUMN hold_lead_id INTEGER REFERENCES leads(id);
      ALTER TABLE properties ADD COLUMN hold_note TEXT;
      CREATE INDEX idx_properties_hold ON properties(status, hold_until);

      ALTER TABLE leads ADD COLUMN referred_by_customer_id INTEGER REFERENCES customers(id);
      CREATE INDEX idx_leads_referred ON leads(referred_by_customer_id);

      CREATE TABLE price_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        block TEXT NOT NULL DEFAULT '',
        rate_per_sqft INTEGER NOT NULL,
        effective_from TEXT NOT NULL,
        note TEXT,
        units_updated INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_price_list ON price_list(project, block, effective_from);

      CREATE TABLE refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        receipt_number TEXT UNIQUE,
        paid_total INTEGER NOT NULL,
        deduction INTEGER NOT NULL DEFAULT 0,
        deduction_reason TEXT,
        refund_amount INTEGER NOT NULL,
        method TEXT NOT NULL,
        reference TEXT,
        refund_date TEXT NOT NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_refunds_customer ON refunds(customer_id);

      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        customer_id INTEGER REFERENCES customers(id),
        lead_id INTEGER REFERENCES leads(id),
        site_visit_id INTEGER UNIQUE REFERENCES site_visits(id),
        agent_id INTEGER REFERENCES users(id),
        given_by TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_feedback_kind ON feedback(kind, created_at);
    `);
  },
};
