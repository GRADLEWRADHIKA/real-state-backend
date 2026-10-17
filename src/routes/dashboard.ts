import { Router } from 'express';
import { getSettings } from '../services/settings.js';
import { db } from '../db/index.js';
import { authorize, isScoped } from '../middleware/auth.js';
import { ACTIVE_STAGES, LEAD_SOURCES, LEAD_STATUSES } from '../utils/constants.js';
import { addDays, financialYear, lastMonths, pctChange, today } from '../utils/dates.js';
import { syncInstallmentStatuses } from '../services/payments.js';

const r = Router();

/**
 * "My day" for the field app: today's visits, follow-ups (today + overdue), open tasks and, for
 * accounts, today's dues. Small enough to cache offline.
 */
r.get('/today', authorize('admin', 'manager', 'sales', 'accounts'), async (req, res) => {
  const u = req.user;
  const t = today();
  const mine = u.role !== 'admin' && u.role !== 'manager';
  const sp = mine ? [u.id] : [];
  const [visits, followups, tasks, dues] = await Promise.all([
    u.role === 'accounts'
      ? []
      : db.all(
          `SELECT v.*, l.name AS lead_name, l.phone AS lead_phone, u.name AS agent_name, p.project AS property_project, p.unit_number AS property_unit,
                  p.location AS property_location, p.city AS property_city
           FROM site_visits v JOIN leads l ON l.id = v.lead_id LEFT JOIN users u ON u.id = v.agent_id LEFT JOIN properties p ON p.id = v.property_id
           WHERE v.visit_date = ? AND v.status IN ('Scheduled','Rescheduled','Completed')${mine ? ' AND v.agent_id = ?' : ''} ORDER BY v.visit_time`,
          [t, ...sp],
        ),
    u.role === 'accounts'
      ? []
      : db.all(
          `SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, l.code AS lead_code, u.name AS agent_name
           FROM followups f JOIN leads l ON l.id = f.lead_id LEFT JOIN users u ON u.id = f.agent_id
           WHERE f.status = 'Pending' AND f.due_date <= ?${mine ? ' AND f.agent_id = ?' : ''} ORDER BY f.due_date, f.due_time LIMIT 100`,
          [t, ...sp],
        ),
    db.all(
      `SELECT t.*, l.name AS lead_name, c.name AS customer_name FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.status != 'Completed' AND (t.due_date IS NULL OR t.due_date <= ?) AND t.assigned_to = ? ORDER BY t.due_date IS NULL, t.due_date LIMIT 50`,
      [addDays(t, 1), u.id],
    ),
    u.role === 'accounts' || u.role === 'admin'
      ? db.all(
          `SELECT i.id, i.label, i.due_date, i.amount, i.paid_amount, i.amount - i.paid_amount AS balance, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone
           FROM installments i JOIN customers c ON c.id = i.customer_id
           WHERE c.status != 'Cancelled' AND i.paid_amount < i.amount AND i.due_date <= ? ORDER BY i.due_date LIMIT 50`,
          [t],
        )
      : [],
  ]);
  res.json({
    date: t,
    visits,
    followups: { today: followups.filter((f: any) => f.due_date === t), overdue: followups.filter((f: any) => f.due_date < t) },
    tasks,
    dues,
  });
});

r.use(authorize('admin', 'manager', 'sales'));

r.get('/', async (req, res) => {
  await syncInstallmentStatuses();
  const u = req.user;
  const scoped = isScoped(u);
  const t = today();
  const d30 = addDays(t, -30);
  const d60 = addDays(t, -60);
  const months = lastMonths(12);
  const m = (col: string) => db.dialect.month(col);

  // Scope fragments (sales executives see only their own book of business).
  const L = scoped ? ' AND l.assigned_to = ?' : '';
  const C = scoped ? ' AND c.assigned_to = ?' : '';
  const D = scoped ? ' AND d.agent_id = ?' : '';
  const sp = scoped ? [u.id] : [];

  const leadStats = await db.get(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN substr(l.created_at, 1, 10) > ? THEN 1 ELSE 0 END), 0) AS last30,
       COALESCE(SUM(CASE WHEN substr(l.created_at, 1, 10) > ? AND substr(l.created_at, 1, 10) <= ? THEN 1 ELSE 0 END), 0) AS prev30,
       COALESCE(SUM(CASE WHEN l.status IN (${ACTIVE_STAGES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) AS active,
       COALESCE(SUM(CASE WHEN l.status IN (${ACTIVE_STAGES.map(() => '?').join(',')}) THEN l.budget END), 0) AS active_value,
       COALESCE(SUM(CASE WHEN l.status = 'New' THEN 1 ELSE 0 END), 0) AS status_new
     FROM leads l WHERE 1=1${L}`,
    [d30, d60, d30, ...ACTIVE_STAGES, ...ACTIVE_STAGES, ...sp],
  );
  const stageMoves = await db.get(
    `SELECT SUM(CASE WHEN substr(a.created_at, 1, 10) > ? THEN 1 ELSE 0 END) AS last30,
            SUM(CASE WHEN substr(a.created_at, 1, 10) > ? AND substr(a.created_at, 1, 10) <= ? THEN 1 ELSE 0 END) AS prev30
     FROM activities a JOIN leads l ON l.id = a.lead_id
     WHERE a.type = 'status' AND a.title IN (${ACTIVE_STAGES.map((s) => `'Moved to ${s}'`).join(',')})${L}`,
    [d30, d60, d30, ...sp],
  );
  const dealStats = await db.get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(d.value), 0) AS value,
       COALESCE(SUM(CASE WHEN d.booking_date > ? THEN 1 ELSE 0 END), 0) AS last30,
       COALESCE(SUM(CASE WHEN d.booking_date > ? AND d.booking_date <= ? THEN 1 ELSE 0 END), 0) AS prev30
     FROM deals d WHERE d.status != 'Cancelled'${D}`,
    [d30, d60, d30, ...sp],
  );
  const fy = financialYear();
  const rev = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN t.payment_date >= ? THEN t.amount END), 0) AS fy,
       COALESCE(SUM(CASE WHEN t.payment_date > ? THEN t.amount END), 0) AS last30,
       COALESCE(SUM(CASE WHEN t.payment_date > ? AND t.payment_date <= ? THEN t.amount END), 0) AS prev30
     FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.status = 'Completed'${C}`,
    [fy.start, d30, d60, d30, ...sp],
  );
  const dues = await db.get(
    `SELECT COALESCE(SUM(i.paid_amount), 0) AS collected,
       COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date >= ? THEN i.amount - i.paid_amount END), 0) AS pending,
       COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date < ? THEN i.amount - i.paid_amount END), 0) AS overdue,
       COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
     FROM installments i JOIN customers c ON c.id = i.customer_id WHERE c.status != 'Cancelled'${C}`,
    [t, t, t, ...sp],
  );

  // Monthly series
  const leadMonthly = await db.all(`SELECT ${m('l.created_at')} AS k, COUNT(*) AS n FROM leads l WHERE l.created_at >= ?${L} GROUP BY k`, [`${months[0]}-01`, ...sp]);
  const dealMonthly = await db.all(`SELECT ${m('d.booking_date')} AS k, COUNT(*) AS n, SUM(d.value) AS v FROM deals d WHERE d.booking_date >= ?${D} GROUP BY k`, [`${months[0]}-01`, ...sp]);
  const revMonthly = await db.all(
    `SELECT ${m('t.payment_date')} AS k, SUM(t.amount) AS v FROM transactions t JOIN customers c ON c.id = t.customer_id
     WHERE t.status = 'Completed' AND t.payment_date >= ?${C} GROUP BY k`,
    [`${months[0]}-01`, ...sp],
  );
  const idx = (rows: any[]) => Object.fromEntries(rows.map((x) => [x.k, x]));
  const [lm, dm, rm] = [idx(leadMonthly), idx(dealMonthly), idx(revMonthly)];
  const revenue = months.map((k) => ({ month: k, collected: rm[k]?.v ?? 0, booked: dm[k]?.v ?? 0, deals: dm[k]?.n ?? 0, leads: lm[k]?.n ?? 0 }));
  const trend = (key: 'leads' | 'deals' | 'collected') => revenue.slice(-7).map((x) => x[key]);

  const pipelineRows = await db.all(`SELECT l.status, COUNT(*) AS n, COALESCE(SUM(l.budget), 0) AS v FROM leads l WHERE 1=1${L} GROUP BY l.status`, sp);
  const pm = Object.fromEntries(pipelineRows.map((x) => [x.status, x]));
  const pipeline = LEAD_STATUSES.map((s) => ({ stage: s, count: pm[s]?.n ?? 0, value: pm[s]?.v ?? 0 }));

  const sourceRows = await db.all(
    `SELECT l.source, COUNT(*) AS n, SUM(CASE WHEN l.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS converted FROM leads l WHERE 1=1${L} GROUP BY l.source`,
    sp,
  );
  const sm = Object.fromEntries(sourceRows.map((x) => [x.source, x]));
  const sources = LEAD_SOURCES.map((s) => ({ source: s, count: sm[s]?.n ?? 0, converted: sm[s]?.converted ?? 0 }));

  // The leaderboard compares colleagues, so sales executives do not get it.
  const leaderboard = scoped ? null : await db.all(
    `SELECT u.id, u.name, u.title,
       (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = u.id) AS leads,
       (SELECT COUNT(*) FROM site_visits v WHERE v.agent_id = u.id AND v.status = 'Completed') AS site_visits,
       (SELECT COUNT(*) FROM deals d WHERE d.agent_id = u.id AND d.status != 'Cancelled') AS deals,
       (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.agent_id = u.id AND d.status != 'Cancelled') AS revenue
     FROM users u WHERE u.role = 'sales' AND u.status = 'Active' ORDER BY revenue DESC, deals DESC LIMIT 8`,
  );

  const todayVisits = await db.all(
    `SELECT v.*, l.name AS lead_name, l.phone AS lead_phone, u.name AS agent_name, p.project AS property_project, p.unit_number AS property_unit
     FROM site_visits v JOIN leads l ON l.id = v.lead_id LEFT JOIN users u ON u.id = v.agent_id LEFT JOIN properties p ON p.id = v.property_id
     WHERE v.visit_date = ? AND v.status IN ('Scheduled','Rescheduled','Completed')${scoped ? ' AND v.agent_id = ?' : ''} ORDER BY v.visit_time`,
    [t, ...sp],
  );
  const F = scoped ? ' AND f.agent_id = ?' : '';
  const fSelect = `SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, u.name AS agent_name FROM followups f JOIN leads l ON l.id = f.lead_id LEFT JOIN users u ON u.id = f.agent_id`;
  const [fToday, fOverdue, fUpcoming] = await Promise.all([
    db.all(`${fSelect} WHERE f.status = 'Pending' AND f.due_date = ?${F} ORDER BY f.due_time`, [t, ...sp]),
    db.all(`${fSelect} WHERE f.status = 'Pending' AND f.due_date < ?${F} ORDER BY f.due_date DESC, f.due_time`, [t, ...sp]),
    db.all(`${fSelect} WHERE f.status = 'Pending' AND f.due_date > ? AND f.due_date <= ?${F} ORDER BY f.due_date, f.due_time`, [t, addDays(t, 7), ...sp]),
  ]);

  const recentActivity = await db.all(
    `SELECT a.*, u.name AS user_name, l.name AS lead_name, c.name AS customer_name
     FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN leads l ON l.id = a.lead_id LEFT JOIN customers c ON c.id = a.customer_id
     WHERE a.type NOT IN ('note','audit')${scoped ? ' AND (l.assigned_to = ? OR c.assigned_to = ?)' : ''}
     ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
    scoped ? [u.id, u.id] : [],
  );
  const hotLeads = await db.all(
    `SELECT l.id, l.code, l.name, l.status, l.budget, l.next_followup, p.project AS property_project, p.unit_number AS property_unit, us.name AS agent_name
     FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users us ON us.id = l.assigned_to
     WHERE l.priority = 'Hot' AND l.status IN ('Qualified','Site Visit','Negotiation')${L} ORDER BY l.budget DESC LIMIT 5`,
    sp,
  );

  res.json({
    kpis: {
      total_leads: { value: leadStats.total, change: pctChange(leadStats.last30, leadStats.prev30), sub: `${leadStats.last30} added in 30 days`, trend: trend('leads') },
      new_leads: { value: leadStats.last30, change: pctChange(leadStats.last30, leadStats.prev30), sub: `${leadStats.status_new} awaiting first contact`, trend: trend('leads') },
      active_deals: { value: leadStats.active, change: pctChange(stageMoves?.last30 ?? 0, stageMoves?.prev30 ?? 0), sub: `Pipeline worth`, amount: leadStats.active_value, trend: [] },
      properties_sold: { value: dealStats.total, change: pctChange(dealStats.last30, dealStats.prev30), sub: `${dealStats.last30} booked in 30 days`, trend: trend('deals') },
      revenue: { value: rev.fy, change: pctChange(rev.last30, rev.prev30), sub: `Collected in FY ${fy.label}`, trend: trend('collected') },
      outstanding: { value: dues.pending + dues.overdue, overdue: dues.overdue, overdue_count: dues.overdue_count ?? 0, sub: 'Receivable from customers', trend: [] },
    },
    pipeline,
    revenue,
    sources,
    leaderboard,
    collections: { collected: dues.collected, pending: dues.pending, overdue: dues.overdue },
    // Company-wide targets; a sales executive's numbers are their own, so no target is shown to them.
    targets: req.user.role === 'sales' ? null : (await getSettings()).targets,
    todayVisits,
    followups: { today: fToday, overdue: fOverdue, upcoming: fUpcoming },
    recentActivity,
    hotLeads,
  });
});

export default r;
