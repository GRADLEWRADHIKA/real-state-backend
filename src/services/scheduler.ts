import { REGISTRY_REMINDER_DAYS, fmtTime, inr } from '@estateflow/shared';
import { dailyBackupIfDue } from './backup.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { log } from '../logger.js';
import { addDays, nowIso, today } from '../utils/dates.js';
import { notifyRoles, notifyUsers, portalUserFor, type NotificationInput } from './notifications.js';
import { syncInstallmentStatuses } from './payments.js';
import { getSetting } from './settings.js';

/**
 * In-process reminder scheduler. Each reminder is recorded in reminder_log (kind, record, user, day)
 * before it is sent, so restarts and overlapping ticks never send the same reminder twice.
 */

/** Claims a reminder slot; false when it was already sent. */
async function claim(kind: string, refId: number, userId: number, day: string) {
  const r = await db.run('INSERT INTO reminder_log (kind, ref_id, user_id, sent_on) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [kind, refId, userId, day]);
  return r.changes > 0;
}

async function remind(kind: string, refId: number, userId: number | null | undefined, day: string, n: NotificationInput) {
  if (!userId) return 0;
  if (!(await claim(kind, refId, userId, day))) return 0;
  await notifyUsers([userId], n);
  return 1;
}

const minutesUntil = (date: string, time: string | null, now: Date) => (new Date(`${date}T${time || '09:00'}:00`).getTime() - now.getTime()) / 60_000;

export async function runScheduledJobs(now = new Date()) {
  const t = today();
  const sent = { followups: 0, overdue: 0, visits: 0, installments: 0, digests: 0, registry: 0, salary: 0, backup: 0 };
  await syncInstallmentStatuses(true);

  // Follow-ups: a reminder up to an hour before, then one "overdue" notice once the time has passed.
  const followups = await db.all(
    `SELECT f.id, f.agent_id, f.due_date, f.due_time, f.type, f.overdue_at, l.id AS lead_id, l.name AS lead_name
     FROM followups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'Pending' AND f.due_date <= ?`,
    [t],
  );
  for (const f of followups) {
    const mins = minutesUntil(f.due_date, f.due_time, now);
    if (mins > 0 && mins <= 60) {
      sent.followups += await remind('followup', f.id, f.agent_id, t, {
        type: 'followup',
        title: `${f.type} at ${fmtTime(f.due_time)}`,
        message: `Follow up with ${f.lead_name}.`,
        link: `/leads/${f.lead_id}`,
        trigger: 'followup_reminder',
      });
    } else if (mins <= 0 && !f.overdue_at) {
      await db.update('followups', f.id, { overdue_at: nowIso() });
      sent.overdue += await remind('followup_overdue', f.id, f.agent_id, t, {
        type: 'alert',
        title: 'Follow-up overdue',
        message: `${f.type} with ${f.lead_name} was due ${f.due_date === t ? `at ${fmtTime(f.due_time)}` : `on ${f.due_date}`}.`,
        link: `/leads/${f.lead_id}`,
        trigger: 'followup_reminder',
      });
    }
  }

  // Site visits: a reminder up to two hours before.
  const visits = await db.all(
    `SELECT v.id, v.agent_id, v.visit_date, v.visit_time, l.name AS lead_name, l.id AS lead_id, p.project, p.unit_number
     FROM site_visits v JOIN leads l ON l.id = v.lead_id LEFT JOIN properties p ON p.id = v.property_id
     WHERE v.visit_date = ? AND v.status IN ('Scheduled','Rescheduled')`,
    [t],
  );
  for (const v of visits) {
    const mins = minutesUntil(v.visit_date, v.visit_time, now);
    if (mins > 0 && mins <= 120) {
      sent.visits += await remind('site_visit', v.id, v.agent_id, t, {
        type: 'visit',
        title: `Site visit at ${fmtTime(v.visit_time)}`,
        message: `${v.lead_name}${v.project ? ` · ${v.project} ${v.unit_number ?? ''}` : ''}`.trim(),
        link: `/site-visits/${v.id}`,
        trigger: 'site_visit_reminder',
      });
    }
  }

  // Installments: customers hear 3 days before and on the due date; the agent and accounts hear the day after.
  const dueSoon = await db.all(
    `SELECT i.id, i.label, i.due_date, i.amount - i.paid_amount AS balance, c.id AS customer_id, c.name AS customer_name, c.assigned_to
     FROM installments i JOIN customers c ON c.id = i.customer_id
     WHERE c.status != 'Cancelled' AND i.paid_amount < i.amount AND i.due_date IN (?, ?, ?)`,
    [t, addDays(t, 3), addDays(t, -1)],
  );
  for (const i of dueSoon) {
    if (i.due_date === addDays(t, -1)) {
      const n: NotificationInput = {
        type: 'alert',
        title: 'Installment overdue',
        message: `${i.customer_name}: ${i.label} of ${inr(i.balance)} was due yesterday.`,
        link: `/customers/${i.customer_id}?tab=payments`,
        trigger: 'installment_due',
      };
      if (await claim('installment_overdue', i.id, 0, t)) {
        await notifyUsers([i.assigned_to], n);
        await notifyRoles(['accounts'], n);
        sent.installments++;
      }
      continue;
    }
    const portal = await portalUserFor(i.customer_id);
    sent.installments += await remind(i.due_date === t ? 'installment_due_today' : 'installment_due_soon', i.id, portal?.id, t, {
      type: 'payment',
      title: i.due_date === t ? 'Installment due today' : 'Installment due in 3 days',
      message: `${i.label}: ${inr(i.balance)} due on ${i.due_date}.`,
      link: '/payments',
      trigger: 'installment_due',
    });
  }

  // Registry: 15, 7 and 1 day before a fixed date, and on the day, to the customer's executive, managers and the customer.
  for (const days of REGISTRY_REMINDER_DAYS) {
    const due = await db.all(
      `SELECT c.id, c.name, c.code, c.registry_date, c.assigned_to FROM customers c
       WHERE c.status != 'Cancelled' AND c.registry_status = 'Date fixed' AND c.registry_date = ?`,
      [addDays(t, days)],
    );
    for (const c of due) {
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days (${c.registry_date})`;
      const n: NotificationInput = { type: 'alert', title: 'Registry reminder', message: `${c.name} (${c.code}): registry ${when}.`, link: `/customers/${c.id}` };
      if (await claim(`registry_${days}`, c.id, 0, t)) {
        await notifyUsers([c.assigned_to], n);
        await notifyRoles(['admin', 'manager'], n);
        sent.registry++;
      }
      const portal = await portalUserFor(c.id);
      sent.registry += await remind(`registry_customer_${days}`, c.id, portal?.id, t, {
        type: 'property',
        title: 'Registry reminder',
        message: `Your property registry is ${when}. Please keep your ID proof, photos and payment receipts ready.`,
        link: '/home',
      });
    }
  }

  // Salary: from the 1st of each month, remind accounts once a day while last month's salaries are unpaid.
  const lastMonth = addDays(`${t.slice(0, 7)}-01`, -1).slice(0, 7);
  if (Number(t.slice(8, 10)) <= 7) {
    const unpaid = await db.get<{ n: number; amount: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(u.monthly_salary - COALESCE(p.paid, 0)), 0) AS amount FROM users u
       LEFT JOIN (SELECT user_id, SUM(amount) AS paid FROM salary_payments WHERE month = ? GROUP BY user_id) p ON p.user_id = u.id
       WHERE u.status = 'Active' AND u.role != 'customer' AND u.monthly_salary > COALESCE(p.paid, 0)`,
      [lastMonth],
    );
    if (unpaid!.n && (await claim('salary_due', 0, 0, t))) {
      await notifyRoles(['admin', 'accounts'], {
        type: 'payment',
        title: 'Salary reminder',
        message: `${unpaid!.n} staff salar${unpaid!.n === 1 ? 'y' : 'ies'} for ${lastMonth} still unpaid (${inr(unpaid!.amount)}).`,
        link: '/staff?tab=salary',
      });
      sent.salary++;
    }
  }

  // Automatic daily backup of the database.
  try {
    if (await dailyBackupIfDue()) sent.backup++;
  } catch (err) {
    log.error('daily backup failed', { err });
  }

  // Morning digest for the field team (off by default in Settings → Notifications).
  if (now.getHours() >= 8 && (await getSetting('notifications')).daily_digest) {
    const staff = await db.all("SELECT id FROM users WHERE status = 'Active' AND role IN ('sales','manager')");
    for (const u of staff) {
      const [fu, vi] = await Promise.all([
        db.get<{ n: number }>("SELECT COUNT(*) AS n FROM followups WHERE agent_id = ? AND status = 'Pending' AND due_date <= ?", [u.id, t]),
        db.get<{ n: number }>("SELECT COUNT(*) AS n FROM site_visits WHERE agent_id = ? AND visit_date = ? AND status IN ('Scheduled','Rescheduled')", [u.id, t]),
      ]);
      if (!fu!.n && !vi!.n) continue;
      sent.digests += await remind('daily_digest', 0, u.id, t, {
        type: 'info',
        title: 'Your day',
        message: `${vi!.n} site visit${vi!.n === 1 ? '' : 's'} and ${fu!.n} follow-up${fu!.n === 1 ? '' : 's'} today.`,
        link: '/today',
        trigger: 'daily_digest',
      });
    }
  }

  // Housekeeping.
  await db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [new Date(now.getTime() - 7 * 86_400_000).toISOString()]);
  await db.run("UPDATE password_reset_requests SET status = 'Dismissed', code_hash = NULL WHERE status = 'Issued' AND code_expires_at < ?", [nowIso()]);
  await db.run('DELETE FROM reminder_log WHERE sent_on < ?', [addDays(t, -60)]);
  return sent;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startScheduler() {
  if (timer || config.schedulerIntervalMs <= 0) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await runScheduledJobs();
      if (Object.values(sent).some(Boolean)) log.info('scheduler', sent);
    } catch (err) {
      log.error('scheduler failed', { err });
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000).unref();
  timer = setInterval(tick, config.schedulerIntervalMs);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
