import { Router } from 'express';
import { priceListBody } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { HttpError, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { realtime } from '../services/realtime.js';

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
  const units = await db.all<{ id: number; area_sqft: number }>(
    "SELECT id, area_sqft FROM properties WHERE project = ? AND COALESCE(block, '') = ? AND status IN ('Available','Reserved')",
    [data.project, data.block],
  );
  const known = await db.get("SELECT id FROM properties WHERE project = ? AND COALESCE(block, '') = ? LIMIT 1", [data.project, data.block]);
  if (!known) throw new HttpError(422, `block: No units in ${data.project}${data.block ? ` block ${data.block}` : ''}`);
  const applyNow = data.apply_to_unsold && data.effective_from <= today();
  const id = await db.transaction(async () => {
    if (applyNow) {
      for (const u of units) await db.update('properties', u.id, { rate_per_sqft: data.rate_per_sqft, price: data.rate_per_sqft * u.area_sqft, updated_at: nowIso() });
    }
    const rowId = await db.insert('price_list', {
      project: data.project,
      block: data.block,
      rate_per_sqft: data.rate_per_sqft,
      effective_from: data.effective_from,
      note: data.note ?? null,
      units_updated: applyNow ? units.length : 0,
      created_by: req.user.id,
      created_at: nowIso(),
    });
    await logActivity({ type: 'price', title: `Rate set for ${data.project}${data.block ? ` block ${data.block}` : ''}`, description: `₹${data.rate_per_sqft.toLocaleString('en-IN')} per sq ft from ${data.effective_from}${applyNow ? `, ${units.length} unsold units re-priced` : ''}`, user_id: req.user.id });
    return rowId;
  });
  if (applyNow) realtime.change(['properties'], { staffOnly: true });
  res.status(201).json(await db.get(`${SELECT} WHERE pl.id = ?`, [id]));
});

export default r;
