import type { Migration } from './types.js';

/**
 * Plot-business features: blocks and rate per sq ft, registry and nominee on customers, brokers and
 * their commissions, expenses, staff salary, attendance and sales targets.
 */
export const migration: Migration = {
  id: '005_plot_crm',
  async up(db) {
    await db.exec(`
      ALTER TABLE properties ADD COLUMN block TEXT;
      ALTER TABLE properties ADD COLUMN rate_per_sqft INTEGER;
      CREATE INDEX idx_properties_block ON properties(block);

      CREATE TABLE brokers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        firm TEXT,
        commission_pct REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Active',
        notes TEXT,
        created_at TEXT NOT NULL
      );

      ALTER TABLE customers ADD COLUMN nominee_name TEXT;
      ALTER TABLE customers ADD COLUMN nominee_relation TEXT;
      ALTER TABLE customers ADD COLUMN nominee_phone TEXT;
      ALTER TABLE customers ADD COLUMN nominee_aadhaar TEXT;
      ALTER TABLE customers ADD COLUMN registry_status TEXT NOT NULL DEFAULT 'Not done';
      ALTER TABLE customers ADD COLUMN registry_date TEXT;
      ALTER TABLE customers ADD COLUMN registry_number TEXT;
      ALTER TABLE customers ADD COLUMN broker_id INTEGER REFERENCES brokers(id);
      CREATE INDEX idx_customers_registry ON customers(registry_status, registry_date);

      ALTER TABLE users ADD COLUMN monthly_salary INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN monthly_target INTEGER NOT NULL DEFAULT 0;

      -- One row per completed customer payment that came through a broker.
      CREATE TABLE broker_commissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        broker_id INTEGER NOT NULL REFERENCES brokers(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
        payment_amount INTEGER NOT NULL,
        pct REAL NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Due',
        paid_on TEXT,
        paid_method TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_commissions_broker ON broker_commissions(broker_id, status);

      CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount INTEGER NOT NULL,
        method TEXT NOT NULL,
        paid_to TEXT,
        reference TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_expenses_date ON expenses(expense_date);

      CREATE TABLE salary_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        month TEXT NOT NULL,
        amount INTEGER NOT NULL,
        paid_on TEXT NOT NULL,
        method TEXT NOT NULL,
        notes TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_salary_user_month ON salary_payments(user_id, month);

      CREATE TABLE attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Present',
        check_in_at TEXT,
        check_out_at TEXT,
        check_in_lat REAL,
        check_in_lng REAL,
        notes TEXT,
        marked_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        UNIQUE (user_id, date)
      );
    `);
  },
};
