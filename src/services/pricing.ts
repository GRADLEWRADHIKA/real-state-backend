import { db } from '../db/index.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity } from './activity.js';
import { realtime } from './realtime.js';

/** True when no later rate for the same project and block is already in effect today. */
export async function isCurrentRate(project: string, block: string, effectiveFrom: string, excludeId?: number) {
  const newer = await db.get(
    'SELECT id FROM price_list WHERE project = ? AND block = ? AND effective_from > ? AND effective_from <= ? AND id != ? LIMIT 1',
    [project, block, effectiveFrom, today(), excludeId ?? 0],
  );
  return !newer;
}

/** Re-prices the unsold (available and on-hold) units of a project and block. Returns how many changed. */
export async function repriceUnsold(project: string, block: string, rate: number) {
  const units = await db.all<{ id: number; area_sqft: number }>(
    "SELECT id, area_sqft FROM properties WHERE project = ? AND COALESCE(block, '') = ? AND status IN ('Available','Reserved')",
    [project, block],
  );
  for (const u of units) await db.update('properties', u.id, { rate_per_sqft: rate, price: rate * u.area_sqft, updated_at: nowIso() });
  return units.length;
}

/** Scheduler: applies future-dated rates whose date has come. A rate overtaken by a later one is just closed. */
export async function applyDueRates() {
  const due = await db.all<{ id: number; project: string; block: string; rate_per_sqft: number; effective_from: string }>(
    'SELECT id, project, block, rate_per_sqft, effective_from FROM price_list WHERE apply_pending = 1 AND effective_from <= ? ORDER BY effective_from, id',
    [today()],
  );
  let applied = 0;
  for (const p of due) {
    await db.transaction(async () => {
      const current = await isCurrentRate(p.project, p.block, p.effective_from, p.id);
      const n = current ? await repriceUnsold(p.project, p.block, p.rate_per_sqft) : 0;
      await db.update('price_list', p.id, { apply_pending: 0, units_updated: n });
      if (current) {
        await logActivity({ type: 'price', title: `Rate applied for ${p.project}${p.block ? ` block ${p.block}` : ''}`, description: `₹${p.rate_per_sqft.toLocaleString('en-IN')} per sq ft from ${p.effective_from}, ${n} unsold units re-priced` });
        applied++;
      }
    });
  }
  if (applied) realtime.change(['properties'], { staffOnly: true });
  return applied;
}
