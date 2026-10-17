// Money stays in integer rupees and dates are ISO strings everywhere; these helpers only format.
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN');
const pad = (n: number) => String(n).padStart(2, '0');

/** ₹85,00,000 */
export const inr = (n?: number | null) => (n === null || n === undefined ? '—' : inrFmt.format(n));
export const num = (n?: number | null) => (n === null || n === undefined ? '—' : numFmt.format(n));
/** "Rs. 85,00,000" — ASCII-safe variant for PDFs and CSV. */
export const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;

/** ₹85 L · ₹1.24 Cr · ₹45K — Indian short scale. */
export function inrShort(n?: number | null, digits = 2): string {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const trim = (v: number) => String(Number(v.toFixed(digits)));
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${a}`;
}

const toDate = (v: string) => (v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v));

/** Local calendar date as YYYY-MM-DD. */
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toDateStr(d);
}
export function addDays(date: string | Date, days: number): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00`) : new Date(date);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}
/** Same day-of-month `months` later, clamped to the month's last day. */
export function addMonths(date: string, months: number, day?: number): string {
  const d = new Date(`${date}T00:00:00`);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day ?? d.getDate(), last));
  return toDateStr(target);
}
/** Last `n` calendar months (oldest first) as YYYY-MM keys. */
export function lastMonths(n: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  return out;
}
/** Indian financial year label (e.g. 2026-27) and its start date. */
export function financialYear(d = new Date()) {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { label: `${startYear}-${String(startYear + 1).slice(2)}`, start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
export const daysBetween = (a: string, b: string) => Math.round((toDate(b.slice(0, 10)).getTime() - toDate(a.slice(0, 10)).getTime()) / 86400000);

/** 15 Nov 2026 */
export function fmtDate(v?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!v) return '—';
  const d = toDate(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', opts);
}
export const fmtDateShort = (v?: string | null) => fmtDate(v, { day: 'numeric', month: 'short' });
export const fmtDateLong = (v?: string | null) => fmtDate(v, { day: 'numeric', month: 'long', year: 'numeric' });

/** 3:00 PM from "15:00" */
export function fmtTime(t?: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}
export function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${fmtDate(v.slice(0, 10))}, ${fmtTime(v.slice(11))}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`;
}
/** "5 Oct 2026, 12:30 PM" from a date + optional HH:MM. */
export function humanDate(date: string, time?: string) {
  const d = new Date(`${date}T${time ?? '00:00'}:00`);
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!time) return day;
  return `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`;
}
/** "In 3 days", "2 days ago", "Today", "Tomorrow" for calendar dates. */
export function relativeDay(v?: string | null) {
  if (!v) return '—';
  const diff = daysBetween(todayStr(), v);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
/** "5 min ago", "3 h ago", "2 d ago" for timestamps. */
export function timeAgo(v?: string | null) {
  if (!v) return '—';
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(v);
}
export const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
export const monthYearLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export const initials = (name?: string | null) =>
  (name ?? '?')
    .replace(/^(Dr|Mr|Mrs|Ms|Mohd)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
export const firstName = (name?: string | null) => (name ?? '').replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').split(' ')[0];
export function fileSize(bytes?: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export const pct = (v?: number | null) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

// ─── Amount in words (Indian numbering) ──────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const twoDigits = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}
/** 2500000 → "Rupees Twenty Five Lakh Only" */
export function amountInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${crore > 99 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return `Rupees ${parts.join(' ')} Only`;
}
