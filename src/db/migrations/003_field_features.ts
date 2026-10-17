import type { Migration } from './types.js';

const norm = (p: string) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

export const migration: Migration = {
  id: '003_field_features',
  async up(db) {
    await db.exec(`
      ALTER TABLE site_visits ADD COLUMN outcome TEXT;
      ALTER TABLE site_visits ADD COLUMN checked_in_at TEXT;
      ALTER TABLE site_visits ADD COLUMN checkin_lat REAL;
      ALTER TABLE site_visits ADD COLUMN checkin_lng REAL;
      ALTER TABLE site_visits ADD COLUMN checked_out_at TEXT;
      ALTER TABLE site_visits ADD COLUMN checkout_lat REAL;
      ALTER TABLE site_visits ADD COLUMN checkout_lng REAL;

      ALTER TABLE followups ADD COLUMN overdue_at TEXT;

      ALTER TABLE leads ADD COLUMN phone_norm TEXT;
      ALTER TABLE leads ADD COLUMN source_detail TEXT;
      CREATE INDEX idx_leads_phone_norm ON leads(phone_norm);

      ALTER TABLE properties ADD COLUMN construction_stage TEXT;

      ALTER TABLE customers ADD COLUMN cancelled_at TEXT;
      ALTER TABLE customers ADD COLUMN cancel_reason TEXT;

      CREATE TABLE customer_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT,
        preferred_date TEXT,
        status TEXT NOT NULL DEFAULT 'Open',
        response TEXT,
        handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX idx_requests_customer ON customer_requests(customer_id);
      CREATE INDEX idx_requests_status ON customer_requests(status);

      -- One row per reminder sent, so the scheduler never repeats itself.
      CREATE TABLE reminder_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        sent_on TEXT NOT NULL,
        UNIQUE (kind, ref_id, user_id, sent_on)
      );

      CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status);
      CREATE INDEX idx_followups_agent ON followups(agent_id, status, due_date);
      CREATE INDEX idx_site_visits_agent ON site_visits(agent_id, visit_date);
    `);
    const leads = await db.all<{ id: number; phone: string }>('SELECT id, phone FROM leads');
    for (const l of leads) await db.run('UPDATE leads SET phone_norm = ? WHERE id = ?', [norm(l.phone), l.id]);
  },
};
