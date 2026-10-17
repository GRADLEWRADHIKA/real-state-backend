import crypto from 'node:crypto';
import { Router } from 'express';
import { SETTINGS_KEYS, settingsSchemas, type SettingsKey } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize, dashboardOnly } from '../middleware/auth.js';
import { HttpError, parse } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { getSetting, getSettings, saveSetting } from '../services/settings.js';
import { sha256 } from '../services/tokens.js';

const r = Router();

r.get('/', async (_req, res) => {
  res.json(await getSettings());
});

// Configuration is changed from the dashboard by administrators only.
r.use(authorize('admin'), dashboardOnly);

/** Generates the website lead-capture key. The plain key is returned once; only its hash is stored. */
r.post('/lead_capture/key', async (_req, res) => {
  const current = await getSetting('lead_capture');
  const key = `efk_${crypto.randomBytes(24).toString('base64url')}`;
  const next = { ...current, enabled: true, key_prefix: key.slice(0, 10), key_hash: sha256(key), key_created_at: nowIso() };
  await saveSetting('lead_capture', next);
  const { key_hash: _omit, ...visible } = next;
  res.status(201).json({ key, lead_capture: visible });
});

r.delete('/lead_capture/key', async (_req, res) => {
  const current = await getSetting('lead_capture');
  const next = { ...current, enabled: false, key_prefix: '', key_hash: '', key_created_at: '' };
  await saveSetting('lead_capture', next);
  const { key_hash: _omit, ...visible } = next;
  res.json({ lead_capture: visible });
});

r.put('/:key', async (req, res) => {
  const key = String(req.params.key) as SettingsKey;
  if (!SETTINGS_KEYS.includes(key)) throw new HttpError(404, 'Unknown setting');
  const value: any = parse(settingsSchemas[key] as any, req.body);
  const current: any = await getSetting(key);
  if (key === 'assignment' && value.pool.length) {
    const valid = await db.all<{ id: number }>(
      `SELECT id FROM users WHERE role = 'sales' AND status = 'Active' AND id IN (${value.pool.map(() => '?').join(',')})`,
      value.pool,
    );
    if (valid.length !== new Set(value.pool).size) throw new HttpError(422, 'pool: Only active sales executives can be in the rotation');
  }
  if (key === 'lead_capture' && value.enabled && !current.key_hash) throw new HttpError(422, 'enabled: Generate an API key before turning lead capture on');
  // Object settings keep server-managed fields (key hash, rotation pointer) that the form does not send.
  const merged = Array.isArray(value) ? value : { ...current, ...value };
  await saveSetting(key, merged);
  res.json({ key, value: (await getSettings())[key] });
});

export default r;
