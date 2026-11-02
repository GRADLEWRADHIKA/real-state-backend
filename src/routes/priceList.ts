import { Router } from 'express';
import { priceListBody } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { HttpError, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { realtime } from '../services/realtime.js';
import { isCurrentRate, repriceUnsold } from '../services/pricing.js';

/**
 * Rates per project and block, with every change kept. A new rate can re-price the unsold units of
 * that block at once (price = rate × area); booked and sold units keep the price they were sold at.
 */
const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'));

const SELECT = 'SELECT pl.*, u.name AS created_by_name FROM price_list pl LEFT JOIN users u ON u.id = pl.created_by';

/** Current rate for each project and block (latest entry in effect today) plus the full history. */
r.get('/', async (req, res) => {
  const q = parseQuery(z.object({ project: z.string().trim().max(80).optional(), block: z.string().trim().max(30).optional() }), req);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.project) { where += ' AND pl.project = ?'; params.push(q.project); }
  if (q.block !== undefined && q.block !== '') { where += ' AND pl.block = ?'; params.push(q.block); }
  const history = await db.all(`${SELECT} ${where} ORDER BY pl.effective_from DESC, pl.id DESC LIMIT 500`, params);
  const t = today();
  const current = await db.all(
    `SELECT pl.* FROM price_list pl
     WHERE pl.effective_from <= ? AND pl.id = (
       SELECT p2.id FROM price_list p2 WHERE p2.project = pl.project AND p2.block = pl.block AND p2.effective_from <= ?
       ORDER BY p2.effective_from DESC, p2.id DESC LIMIT 1)
     ORDER BY pl.project, pl.block`,
    [t, t],
  );
  const blocks = await db.all(
    `SELECT project, COALESCE(block, '') AS block, COUNT(*) AS units,
       SUM(CASE WHEN status IN ('Available','Reserved') THEN 1 ELSE 0 END) AS unsold,
       MIN(rate_per_sqft) AS min_rate, MAX(rate_per_sqft) AS max_rate
     FROM properties GROUP BY project, COALESCE(block, '') ORDER BY project, block`,
  );
  res.json({ data: history, meta: { current, blocks } });
});

r.post('/', authorize('admin', 'manager'), async (req, res) => {
  const data = parse(priceListBody, req.body);
  const known = await db.get("SELECT id FROM properties WHERE project = ? AND COALESCE(block, '') = ? LIMIT 1", [data.project, data.block]);
  if (!known) throw new HttpError(422, `block: No units in ${data.project}${data.block ? ` block ${data.block}` : ''}`);
  // Units are re-priced only by the rate in effect: not by a back-dated entry that a later rate has
  // already replaced, and a future-dated rate waits for its date (the scheduler applies it then).
  const inEffect = data.effective_from <= today();
  const applyNow = data.apply_to_unsold && inEffect && (await isCurrentRate(data.project, data.block, data.effective_from));
  const pending = data.apply_to_unsold && !inEffect;
  const id = await db.transaction(async () => {
    const updated = applyNow ? await repriceUnsold(data.project, data.block, data.rate_per_sqft) : 0;
    const rowId = await db.insert('price_list', {
      project: data.project,
      block: data.block,
      rate_per_sqft: data.rate_per_sqft,
      effective_from: data.effective_from,
      note: data.note ?? null,
      units_updated: updated,
      apply_pending: pending ? 1 : 0,
      created_by: req.user.id,
      created_at: nowIso(),
    });
    const when = applyNow ? `, ${updated} unsold units re-priced` : pending ? ', unsold units will be re-priced on that date' : '';
    await logActivity({ type: 'price', title: `Rate set for ${data.project}${data.block ? ` block ${data.block}` : ''}`, description: `₹${data.rate_per_sqft.toLocaleString('en-IN')} per sq ft from ${data.effective_from}${when}`, user_id: req.user.id });
    return rowId;
  });
  if (applyNow) realtime.change(['properties'], { staffOnly: true });
  res.status(201).json(await db.get(`${SELECT} WHERE pl.id = ?`, [id]));
});

export default r;
