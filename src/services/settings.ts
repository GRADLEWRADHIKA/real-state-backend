import { DEFAULT_SETTINGS, PRIVATE_SETTING_FIELDS, type Settings, type SettingsKey } from '@estateflow/shared';
import { db } from '../db/index.js';

/** All settings, merged over defaults. `includePrivate` keeps server-only fields (e.g. the lead-capture key hash). */
export async function getSettings(includePrivate = false): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, any> = structuredClone(DEFAULT_SETTINGS);
  for (const row of rows) {
    if (row.key.startsWith('_')) continue;
    const v = JSON.parse(row.value);
    out[row.key] = Array.isArray(v) || typeof v !== 'object' ? v : { ...(out[row.key] ?? {}), ...v };
  }
  if (!includePrivate) {
    for (const [key, fields] of Object.entries(PRIVATE_SETTING_FIELDS)) for (const f of fields ?? []) if (out[key]) delete out[key][f];
  }
  return out as Settings;
}

export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings[K]> {
  return (await getSettings(true))[key];
}

export async function saveSetting<K extends SettingsKey>(key: K, value: Settings[K]) {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
