import type { Response } from 'express';
import type { NotificationItem, RealtimeEvent, RealtimeResource, Role } from '@estateflow/shared';

interface Subscriber {
  userId: number;
  role: Role;
  res: Response;
}

/**
 * In-process SSE hub. A change names the resources it touched; clients invalidate matching queries.
 * `audience` limits delivery (customers only ever get events about their own records).
 */
class RealtimeHub {
  private subs = new Set<Subscriber>();
  private heartbeat: NodeJS.Timeout | null = null;

  add(sub: Subscriber) {
    this.subs.add(sub);
    this.ensureHeartbeat();
    this.write(sub, { type: 'hello', at: new Date().toISOString() });
    return () => {
      this.subs.delete(sub);
      if (!this.subs.size && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    };
  }

  get size() {
    return this.subs.size;
  }

  /** Broadcast a data change. Staff get every change; customers only get changes addressed to them. */
  change(resources: RealtimeResource[], audience?: { userIds?: number[]; staffOnly?: boolean }) {
    const event: RealtimeEvent = { type: 'change', resources, at: new Date().toISOString() };
    for (const s of this.subs) {
      const targeted = audience?.userIds?.includes(s.userId);
      if (s.role === 'customer' && !targeted) continue;
      if (audience?.staffOnly && s.role === 'customer') continue;
      this.write(s, event);
    }
  }

  notify(userId: number, notification: NotificationItem) {
    for (const s of this.subs) if (s.userId === userId) this.write(s, { type: 'notification', notification, resources: ['notifications'], at: new Date().toISOString() });
  }

  /** Ends every stream belonging to a user (logout everywhere / deactivation). */
  disconnectUser(userId: number) {
    for (const s of this.subs) if (s.userId === userId) s.res.end();
  }

  closeAll() {
    for (const s of this.subs) s.res.end();
    this.subs.clear();
  }

  private ensureHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const s of this.subs) s.res.write(`: ping ${Date.now()}\n\n`);
    }, 25_000);
    this.heartbeat.unref();
  }

  private write(s: Subscriber, e: RealtimeEvent) {
    s.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  }
}

export const realtime = new RealtimeHub();
