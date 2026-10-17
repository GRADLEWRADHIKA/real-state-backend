import { DEFAULT_SETTINGS, type NotificationItem, type NotificationTrigger, type Role } from '@estateflow/shared';
import { db } from '../db/index.js';
import { nowIso } from '../utils/dates.js';
import { realtime } from './realtime.js';

export interface NotificationInput {
  type: string;
  title: string;
  message: string;
  link?: string | null;
  /** Settings → Notifications toggle that governs this message (omit for always-on alerts). */
  trigger?: NotificationTrigger;
}

/**
 * Delivery channel. The in-app channel (database row + live SSE push) is the only one shipped:
 * no third-party push service is used. A push provider can be added later by implementing this
 * interface and registering it in `channels`.
 */
export interface NotificationChannel {
  name: string;
  deliver(userId: number, n: NotificationItem): Promise<void>;
}

const inApp: NotificationChannel = {
  name: 'in-app',
  async deliver(userId, n) {
    realtime.notify(userId, n);
  },
};

const channels: NotificationChannel[] = [inApp];
export const registerChannel = (c: NotificationChannel) => channels.push(c);

async function enabled(trigger?: NotificationTrigger) {
  if (!trigger) return true;
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'notifications'");
  const toggles = row ? JSON.parse(row.value) : DEFAULT_SETTINGS.notifications;
  return toggles[trigger] !== false;
}

export async function notifyUsers(userIds: (number | null | undefined)[], n: NotificationInput, exceptUserId?: number) {
  const ids = [...new Set(userIds.filter((id): id is number => !!id && id !== exceptUserId))];
  if (!ids.length || !(await enabled(n.trigger))) return;
  const created_at = nowIso();
  for (const user_id of ids) {
    const id = await db.insert('notifications', { user_id, type: n.type, title: n.title, message: n.message, link: n.link ?? null, is_read: 0, created_at });
    const item: NotificationItem = { id, type: n.type, title: n.title, message: n.message, link: n.link ?? null, is_read: false, created_at };
    for (const c of channels) await c.deliver(user_id, item).catch(() => undefined);
  }
}

export async function notifyRoles(roles: Role[], n: NotificationInput, exceptUserId?: number) {
  const users = await db.all<{ id: number }>(`SELECT id FROM users WHERE status = 'Active' AND role IN (${roles.map(() => '?').join(',')})`, roles);
  await notifyUsers(users.map((u) => u.id), n, exceptUserId);
}

/** Portal login for a customer record (if one exists). */
export async function portalUserFor(customerId: number) {
  return db.get<{ id: number }>("SELECT id FROM users WHERE customer_id = ? AND role = 'customer' AND status = 'Active'", [customerId]);
}
