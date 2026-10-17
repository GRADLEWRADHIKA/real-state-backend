import { db } from '../db/index.js';
import { getSetting, saveSetting } from './settings.js';

/**
 * Round-robin auto-assignment across active sales executives (or the pool chosen in Settings).
 * The pointer (last_user_id) is stored in settings so the rotation survives restarts.
 */
export async function nextAssignee(): Promise<number | null> {
  const s = await getSetting('assignment');
  if (s.mode !== 'round_robin') return null;
  const active = await db.all<{ id: number }>("SELECT id FROM users WHERE role = 'sales' AND status = 'Active' ORDER BY id");
  const pool = s.pool?.length ? active.filter((u) => s.pool.includes(u.id)) : active;
  if (!pool.length) return null;
  const idx = pool.findIndex((u) => u.id > (s.last_user_id ?? 0));
  const pick = pool[idx === -1 ? 0 : idx].id;
  await saveSetting('assignment', { ...s, last_user_id: pick });
  return pick;
}
