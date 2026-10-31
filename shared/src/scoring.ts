import { todayStr } from './format.js';

/** Leads idle for this many days (no call, message or visit logged) count as stuck. */
export const STUCK_LEAD_DAYS = 7;
const CLOSED = ['Booked', 'Closed', 'Lost'];
const STAGE_POINTS: Record<string, number> = { New: 5, Contacted: 10, Qualified: 20, 'Site Visit': 30, Negotiation: 35 };
const PRIORITY_POINTS: Record<string, number> = { Hot: 30, Warm: 15, Cold: 0 };

export interface LeadHeat {
  /** 0–100: how likely and how ready to buy, from stage, priority, budget and how fresh the contact is. */
  score: number;
  /** Whole days since the last logged contact (or since the lead came in, if never contacted). */
  idle_days: number;
  /** An open lead nobody has contacted for STUCK_LEAD_DAYS days or more. */
  stuck: boolean;
  /** A short reason the score is what it is, for the list. */
  reason: string;
}

const days = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from.slice(0, 10))) / 86_400_000));

/**
 * Scores a lead the same way on the server, the dashboard and the app.
 * Stage (up to 35) + priority (up to 30) + a budget on record (10) + freshness (+25 contacted in the
 * last 2 days, down to −20 after a month) − 10 for an overdue follow-up; clamped to 0–100.
 */
export function leadHeat(
  l: { status: string; priority?: string | null; budget?: number | null; last_contact?: string | null; created_at: string; next_followup?: string | null },
  today = todayStr(),
  stuckDays = STUCK_LEAD_DAYS,
): LeadHeat {
  const idle = days(l.last_contact || l.created_at, today);
  if (CLOSED.includes(l.status)) return { score: 0, idle_days: idle, stuck: false, reason: l.status };
  const fresh = idle <= 2 ? 25 : idle <= 7 ? 12 : idle <= 14 ? 0 : idle <= 30 ? -10 : -20;
  const overdue = l.next_followup && l.next_followup.slice(0, 10) < today ? -10 : 0;
  const raw = (STAGE_POINTS[l.status] ?? 5) + (PRIORITY_POINTS[l.priority ?? ''] ?? 10) + (l.budget ? 10 : 0) + fresh + overdue;
  const score = Math.max(0, Math.min(100, raw));
  const stuck = idle >= stuckDays;
  const reason = stuck ? `No contact for ${idle} days` : overdue ? 'Follow-up overdue' : idle <= 2 ? 'Contacted recently' : `Last contact ${idle} days ago`;
  return { score, idle_days: idle, stuck, reason };
}

/** Score band used for labels and sorting cues. */
export const heatBand = (score: number) => (score >= 70 ? 'Hot' : score >= 45 ? 'Warm' : 'Cold');
