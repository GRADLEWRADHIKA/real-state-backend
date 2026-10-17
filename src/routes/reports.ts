import { Router } from 'express';
import { z } from 'zod';
import { daysBetween, fmtDate, monthYearLabel, rangeQuery, rs, toCsv } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize, type AuthUser } from '../middleware/auth.js';
import { HttpError, attachmentHeader, parseQuery } from '../utils/http.js';
import { LEAD_SOURCES, LEAD_STATUSES } from '../utils/constants.js';
import { addDays, today } from '../utils/dates.js';
import { syncInstallmentStatuses } from '../services/payments.js';
import { getSettings } from '../services/settings.js';
import { tablePdf, type PdfColumn } from '../services/pdf.js';

const r = Router();
r.use(authorize('admin', 'manager', 'accounts'));

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00`);
  const end = to.slice(0, 7);
  while (out.length < 36) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(k);
    if (k >= end) break;
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/** Every report section the user's role may see, for one date range. Shared by the JSON view and the exports. */
async function buildReport(user: AuthUser, range: { from?: string; to?: string }) {
  await syncInstallmentStatuses();
  const t = today();
  const from = range.from ?? addDays(t, -365);
  const to = range.to ?? t;
  if (from > to) throw new HttpError(400, 'from must be on or before to');
  const role = user.role;
  const sales = role === 'admin' || role === 'manager';
  const fin = role === 'admin' || role === 'accounts';
  const months = monthsBetween(from, to);
  const m = db.dialect.month;
  const inRange = (col: string) => `substr(${col}, 1, 10) BETWEEN ? AND ?`;
  const out: Record<string, unknown> = { from, to, sections: [] as string[] };
  const sections = out.sections as string[];

  if (sales) {
    const funnel = await db.all(`SELECT status, COUNT(*) AS n FROM leads WHERE ${inRange('created_at')} GROUP BY status`, [from, to]);
    const fm = Object.fromEntries(funnel.map((x) => [x.status, x.n]));
    const total = funnel.reduce((s, x) => s + x.n, 0);
    const won = (fm.Booked ?? 0) + (fm.Closed ?? 0);
    out.conversion = {
      total,
      won,
      lost: fm.Lost ?? 0,
      rate: total ? Math.round((won / total) * 1000) / 10 : 0,
      stages: LEAD_STATUSES.map((s) => ({ stage: s, count: fm[s] ?? 0 })),
    };
    const dealRows = await db.all(
      `SELECT ${m('booking_date')} AS k, COUNT(*) AS n, SUM(value) AS v FROM deals WHERE booking_date BETWEEN ? AND ? AND status != 'Cancelled' GROUP BY k`,
      [from, to],
    );
    const dm = Object.fromEntries(dealRows.map((x) => [x.k, x]));
    out.sales = {
      months: months.map((k) => ({ month: k, deals: dm[k]?.n ?? 0, value: dm[k]?.v ?? 0 })),
      total_deals: dealRows.reduce((s, x) => s + x.n, 0),
      total_value: dealRows.reduce((s, x) => s + x.v, 0),
    };
    out.agents = await db.all(
      `SELECT u.id, u.name, u.role,
         (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = u.id AND ${inRange('l.created_at')}) AS leads,
         (SELECT COUNT(*) FROM followups f WHERE f.agent_id = u.id AND f.status = 'Completed' AND ${inRange('f.completed_at')}) AS followups,
         (SELECT COUNT(*) FROM site_visits v WHERE v.agent_id = u.id AND v.status = 'Completed' AND v.visit_date BETWEEN ? AND ?) AS site_visits,
         (SELECT COUNT(*) FROM deals d WHERE d.agent_id = u.id AND d.status != 'Cancelled' AND d.booking_date BETWEEN ? AND ?) AS deals,
         (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.agent_id = u.id AND d.status != 'Cancelled' AND d.booking_date BETWEEN ? AND ?) AS value
       FROM users u WHERE u.role IN ('sales', 'manager') ORDER BY value DESC, deals DESC`,
      [from, to, from, to, from, to, from, to, from, to],
    );
    const src = await db.all(
      `SELECT l.source, COUNT(*) AS leads,
         SUM(CASE WHEN l.status IN ('Qualified','Site Visit','Negotiation','Booked','Closed') THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN l.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS converted,
         COALESCE(SUM(c.total_value), 0) AS value
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id WHERE ${inRange('l.created_at')} GROUP BY l.source`,
      [from, to],
    );
    const srm = Object.fromEntries(src.map((x) => [x.source, x]));
    out.sources = LEAD_SOURCES.map((s) => {
      const x = srm[s] ?? { leads: 0, qualified: 0, converted: 0, value: 0 };
      return { source: s, leads: x.leads, qualified: x.qualified, converted: x.converted, value: x.value, rate: x.leads ? Math.round((x.converted / x.leads) * 1000) / 10 : 0 };
    });
    sections.push('conversion', 'sales', 'agents', 'sources');
  }

  out.properties = await db.all(
    `SELECT p.project, COUNT(*) AS units,
       SUM(CASE WHEN p.status = 'Available' THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN p.status = 'Reserved' THEN 1 ELSE 0 END) AS reserved,
       SUM(CASE WHEN p.status = 'Booked' THEN 1 ELSE 0 END) AS booked,
       SUM(CASE WHEN p.status = 'Sold' THEN 1 ELSE 0 END) AS sold,
       COALESCE(SUM(CASE WHEN p.status IN ('Available','Reserved') THEN p.price END), 0) AS inventory_value,
       COALESCE(SUM(c.total_value), 0) AS sold_value,
       (SELECT COUNT(*) FROM leads l JOIN properties pp ON pp.id = l.property_id WHERE pp.project = p.project AND l.status != 'Lost') AS interested
     FROM properties p LEFT JOIN customers c ON c.property_id = p.id AND c.status != 'Cancelled'
     GROUP BY p.project ORDER BY sold_value DESC`,
  );
  sections.push('properties');

  if (fin) {
    const rev = await db.all(
      `SELECT ${m('payment_date')} AS k, SUM(amount) AS v, COUNT(*) AS n FROM transactions WHERE status = 'Completed' AND payment_date BETWEEN ? AND ? GROUP BY k`,
      [from, to],
    );
    const rvm = Object.fromEntries(rev.map((x) => [x.k, x]));
    out.revenue = {
      months: months.map((k) => ({ month: k, amount: rvm[k]?.v ?? 0, count: rvm[k]?.n ?? 0 })),
      total: rev.reduce((s, x) => s + x.v, 0),
      count: rev.reduce((s, x) => s + x.n, 0),
    };
    const dues = await db.get(
      `SELECT COALESCE(SUM(i.paid_amount), 0) AS collected,
         COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date >= ? THEN i.amount - i.paid_amount END), 0) AS pending,
         COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date < ? THEN i.amount - i.paid_amount END), 0) AS overdue,
         COALESCE(SUM(CASE WHEN i.due_date BETWEEN ? AND ? THEN i.amount END), 0) AS due_in_range,
         COALESCE(SUM(CASE WHEN i.due_date BETWEEN ? AND ? THEN i.paid_amount END), 0) AS collected_in_range
       FROM installments i JOIN customers c ON c.id = i.customer_id WHERE c.status != 'Cancelled'`,
      [t, t, from, to, from, to],
    );
    out.collection = {
      ...dues,
      efficiency: dues.due_in_range ? Math.round((dues.collected_in_range / dues.due_in_range) * 1000) / 10 : 0,
      methods: await db.all(
        "SELECT method, SUM(amount) AS amount, COUNT(*) AS count FROM transactions WHERE status = 'Completed' AND payment_date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC",
        [from, to],
      ),
    };
    out.outstanding = await db.all(
      `SELECT c.id, c.code, c.name, c.phone, p.project AS property_project, p.unit_number AS property_unit, c.total_value,
         COALESCE(SUM(i.paid_amount), 0) AS paid,
         c.total_value - COALESCE(SUM(i.paid_amount), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date < ? THEN i.amount - i.paid_amount END), 0) AS overdue,
         MIN(CASE WHEN i.paid_amount < i.amount THEN i.due_date END) AS next_due
       FROM customers c LEFT JOIN installments i ON i.customer_id = c.id LEFT JOIN properties p ON p.id = c.property_id
       WHERE c.status != 'Cancelled' GROUP BY c.id, c.code, c.name, c.phone, p.project, p.unit_number, c.total_value
       HAVING c.total_value - COALESCE(SUM(i.paid_amount), 0) > 0 ORDER BY overdue DESC, outstanding DESC`,
      [t],
    );

    // Receivables ageing: overdue balances bucketed by days past due.
    const overdueRows = await db.all(
      `SELECT c.id, c.code, c.name, c.phone, i.due_date, i.amount - i.paid_amount AS balance
       FROM installments i JOIN customers c ON c.id = i.customer_id
       WHERE c.status != 'Cancelled' AND i.paid_amount < i.amount AND i.due_date < ? ORDER BY c.name`,
      [t],
    );
    const buckets = AGING_BUCKETS.map((b) => ({ label: b.label, amount: 0, count: 0 }));
    const perCustomer = new Map<number, { id: number; code: string; name: string; phone: string; buckets: number[]; total: number; oldest_due: string }>();
    for (const row of overdueRows) {
      const days = daysBetween(row.due_date, t);
      const idx = AGING_BUCKETS.findIndex((b) => days <= b.max);
      buckets[idx].amount += row.balance;
      buckets[idx].count++;
      const c = perCustomer.get(row.id) ?? { id: row.id, code: row.code, name: row.name, phone: row.phone, buckets: AGING_BUCKETS.map(() => 0), total: 0, oldest_due: row.due_date };
      c.buckets[idx] += row.balance;
      c.total += row.balance;
      if (row.due_date < c.oldest_due) c.oldest_due = row.due_date;
      perCustomer.set(row.id, c);
    }
    out.aging = { buckets, customers: [...perCustomer.values()].sort((a, b) => b.total - a.total) };
    sections.push('revenue', 'collection', 'outstanding', 'aging');
  }

  return out as Record<string, any> & { from: string; to: string; sections: string[] };
}

const AGING_BUCKETS = [
  { label: '1-30 days', max: 30 },
  { label: '31-60 days', max: 60 },
  { label: '61-90 days', max: 90 },
  { label: 'Over 90 days', max: Infinity },
];

r.get('/', async (req, res) => {
  res.json(await buildReport(req.user, parseQuery(rangeQuery, req)));
});

// ─── Exports ─────────────────────────────────────────────────────────────
interface Table {
  title: string;
  columns: (PdfColumn & { key: string })[];
  rows: Record<string, any>[];
  totals?: Record<string, any>;
}

const money = (v: unknown) => rs(Number(v ?? 0));

/** Section → printable table. Money columns are rupees in CSV (plain integers) and "Rs. 1,00,000" in PDF. */
function tableFor(section: string, rep: Record<string, any>): Table | null {
  switch (section) {
    case 'conversion':
      return {
        title: 'Lead conversion',
        columns: [{ key: 'stage', label: 'Stage', width: 3 }, { key: 'count', label: 'Leads', width: 1, align: 'right' }],
        rows: rep.conversion.stages,
        totals: { stage: `Total (conversion ${rep.conversion.rate}%)`, count: rep.conversion.total },
      };
    case 'sales':
      return {
        title: 'Bookings by month',
        columns: [{ key: 'month', label: 'Month', width: 2 }, { key: 'deals', label: 'Bookings', width: 1, align: 'right' }, { key: 'value', label: 'Value', width: 2, align: 'right' }],
        rows: rep.sales.months.map((m: any) => ({ ...m, month: monthYearLabel(m.month) })),
        totals: { month: 'Total', deals: rep.sales.total_deals, value: rep.sales.total_value },
      };
    case 'agents':
      return {
        title: 'Team performance',
        columns: [
          { key: 'name', label: 'Name', width: 3 },
          { key: 'leads', label: 'Leads', width: 1, align: 'right' },
          { key: 'followups', label: 'Follow-ups done', width: 1.4, align: 'right' },
          { key: 'site_visits', label: 'Site visits', width: 1.2, align: 'right' },
          { key: 'deals', label: 'Bookings', width: 1, align: 'right' },
          { key: 'value', label: 'Booked value', width: 2, align: 'right' },
        ],
        rows: rep.agents,
      };
    case 'sources':
      return {
        title: 'Lead sources',
        columns: [
          { key: 'source', label: 'Source', width: 2 },
          { key: 'leads', label: 'Leads', width: 1, align: 'right' },
          { key: 'qualified', label: 'Qualified', width: 1, align: 'right' },
          { key: 'converted', label: 'Converted', width: 1, align: 'right' },
          { key: 'rate', label: 'Conversion %', width: 1.2, align: 'right' },
          { key: 'value', label: 'Value', width: 2, align: 'right' },
        ],
        rows: rep.sources,
      };
    case 'properties':
      return {
        title: 'Inventory by project',
        columns: [
          { key: 'project', label: 'Project', width: 3 },
          { key: 'units', label: 'Units', width: 1, align: 'right' },
          { key: 'available', label: 'Available', width: 1, align: 'right' },
          { key: 'reserved', label: 'Reserved', width: 1, align: 'right' },
          { key: 'booked', label: 'Booked', width: 1, align: 'right' },
          { key: 'sold', label: 'Sold', width: 1, align: 'right' },
          { key: 'inventory_value', label: 'Unsold value', width: 2, align: 'right' },
          { key: 'sold_value', label: 'Sold value', width: 2, align: 'right' },
        ],
        rows: rep.properties,
      };
    case 'revenue':
      return {
        title: 'Collections by month',
        columns: [{ key: 'month', label: 'Month', width: 2 }, { key: 'count', label: 'Payments', width: 1, align: 'right' }, { key: 'amount', label: 'Collected', width: 2, align: 'right' }],
        rows: rep.revenue.months.map((m: any) => ({ ...m, month: monthYearLabel(m.month) })),
        totals: { month: 'Total', count: rep.revenue.count, amount: rep.revenue.total },
      };
    case 'collection':
      return {
        title: 'Collections by payment method',
        columns: [{ key: 'method', label: 'Method', width: 2 }, { key: 'count', label: 'Payments', width: 1, align: 'right' }, { key: 'amount', label: 'Amount', width: 2, align: 'right' }],
        rows: rep.collection.methods,
      };
    case 'outstanding':
      return {
        title: 'Outstanding balances',
        columns: [
          { key: 'code', label: 'Customer ID', width: 1.4 },
          { key: 'name', label: 'Customer', width: 2.4 },
          { key: 'phone', label: 'Phone', width: 1.6 },
          { key: 'unit', label: 'Unit', width: 2.4 },
          { key: 'total_value', label: 'Value', width: 1.8, align: 'right' },
          { key: 'paid', label: 'Paid', width: 1.8, align: 'right' },
          { key: 'outstanding', label: 'Outstanding', width: 1.8, align: 'right' },
          { key: 'overdue', label: 'Overdue', width: 1.6, align: 'right' },
          { key: 'next_due', label: 'Next due', width: 1.4 },
        ],
        rows: rep.outstanding.map((o: any) => ({ ...o, unit: [o.property_project, o.property_unit].filter(Boolean).join(' · '), next_due: o.next_due ? fmtDate(o.next_due) : '' })),
        totals: {
          code: 'Total',
          outstanding: rep.outstanding.reduce((s: number, o: any) => s + o.outstanding, 0),
          overdue: rep.outstanding.reduce((s: number, o: any) => s + o.overdue, 0),
        },
      };
    case 'aging':
      return {
        title: 'Receivables ageing',
        columns: [
          { key: 'code', label: 'Customer ID', width: 1.4 },
          { key: 'name', label: 'Customer', width: 2.6 },
          { key: 'phone', label: 'Phone', width: 1.6 },
          ...AGING_BUCKETS.map((b, i) => ({ key: `b${i}`, label: b.label, width: 1.6, align: 'right' as const })),
          { key: 'total', label: 'Total overdue', width: 1.8, align: 'right' },
          { key: 'oldest_due', label: 'Oldest due', width: 1.4 },
        ],
        rows: rep.aging.customers.map((c: any) => ({ ...c, ...Object.fromEntries(c.buckets.map((v: number, i: number) => [`b${i}`, v])), oldest_due: fmtDate(c.oldest_due) })),
        totals: {
          code: 'Total',
          ...Object.fromEntries(rep.aging.buckets.map((b: any, i: number) => [`b${i}`, b.amount])),
          total: rep.aging.buckets.reduce((s: number, b: any) => s + b.amount, 0),
        },
      };
  }
  return null;
}

const MONEY_KEYS = new Set(['value', 'inventory_value', 'sold_value', 'amount', 'total_value', 'paid', 'outstanding', 'overdue', 'total', 'b0', 'b1', 'b2', 'b3']);

const exportQuery = rangeQuery.extend({ section: z.string().trim().min(1).max(40), format: z.enum(['csv', 'pdf']).default('csv') });

r.get('/export', async (req, res) => {
  const q = parseQuery(exportQuery, req);
  const rep = await buildReport(req.user, q);
  if (!rep.sections.includes(q.section)) throw new HttpError(404, 'This report section is not available for your role');
  const table = tableFor(q.section, rep)!;
  const base = `${table.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${rep.from}-to-${rep.to}`;
  if (q.format === 'csv') {
    const rows = table.totals ? [...table.rows, table.totals] : table.rows;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentHeader(`${base}.csv`));
    return res.send(toCsv(rows, table.columns.map((c) => ({ key: c.key, label: c.label }))));
  }
  const settings = await getSettings();
  const cell = (row: Record<string, any>, key: string) => (row[key] === undefined || row[key] === null ? '' : MONEY_KEYS.has(key) ? money(row[key]) : row[key]);
  const pdf = tablePdf({
    title: table.title,
    subtitle: `${fmtDate(rep.from)} to ${fmtDate(rep.to)}`,
    company: settings.company.name,
    columns: table.columns,
    rows: table.rows.map((row) => table.columns.map((c) => cell(row, c.key))),
    totals: table.totals ? table.columns.map((c) => cell(table.totals!, c.key)) : undefined,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachmentHeader(`${base}.pdf`));
  res.send(pdf);
});

export default r;
