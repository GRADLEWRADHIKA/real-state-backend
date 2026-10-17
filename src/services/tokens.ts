import crypto from 'node:crypto';
import type { AuthSession, ClientKind } from '@estateflow/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { signAccessToken } from '../middleware/auth.js';
import { HttpError } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { getSetting } from './settings.js';
import { realtime } from './realtime.js';
import { publicUser } from './users.js';

/** A rotated token presented again within this window is a concurrent refresh, not a replay. */
const REUSE_GRACE_MS = 20_000;

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

async function refreshLifetimeMs(remember: boolean) {
  if (remember) return config.refreshRememberDays * 86_400_000;
  const security = await getSetting('security');
  return Math.max(1, security.session_hours) * 3_600_000;
}

async function insertRefresh(userId: number, client: ClientKind, family: string, remember: boolean, expiresAt: string, device?: string | null, ip?: string | null) {
  const token = crypto.randomBytes(40).toString('base64url');
  const id = await db.insert('refresh_tokens', {
    user_id: userId,
    token_hash: sha256(token),
    family,
    client,
    device: device ?? null,
    ip: ip ?? null,
    remember: remember ? 1 : 0,
    expires_at: expiresAt,
    created_at: nowIso(),
  });
  return { token, id };
}

/** New session: access JWT + refresh token stored hashed. */
export async function issueSession(user: any, client: ClientKind, remember: boolean, device?: string, ip?: string): Promise<AuthSession> {
  const expiresAt = new Date(Date.now() + (await refreshLifetimeMs(remember))).toISOString();
  const { token } = await insertRefresh(user.id, client, crypto.randomUUID(), remember, expiresAt, device, ip);
  return { accessToken: signAccessToken(user, client), refreshToken: token, expiresIn: config.accessTokenMinutes * 60, client, user: publicUser(user) };
}

/**
 * Rotation: every refresh token is single-use. Presenting one that was already rotated means it was
 * stolen or replayed, so the whole family (every token descended from that login) is revoked.
 */
export async function rotateSession(refreshToken: string, client: ClientKind, ip?: string): Promise<AuthSession> {
  const hash = sha256(refreshToken);
  const presented = await db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [hash]);
  if (!presented) throw new HttpError(401, 'Your session has expired. Please sign in again.', { code: 'refresh_invalid' });
  if (presented.revoked_at) {
    // Two tabs of the same browser can refresh at once; the loser just picks up the newer token from storage.
    if (presented.replaced_by && Date.now() - new Date(presented.revoked_at).getTime() < REUSE_GRACE_MS) {
      throw new HttpError(401, 'Session was refreshed elsewhere.', { code: 'refresh_superseded' });
    }
    await db.run('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family = ?', [nowIso(), presented.family]);
    throw new HttpError(401, 'This session was ended for your security. Please sign in again.', { code: 'refresh_reused' });
  }
  return db.transaction(async () => {
    const row = await db.get('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL', [hash]);
    if (!row) throw new HttpError(401, 'Session was refreshed elsewhere.', { code: 'refresh_superseded' });
    if (row.expires_at <= nowIso()) throw new HttpError(401, 'Your session has expired. Please sign in again.', { code: 'refresh_expired' });
    if (row.client !== client) throw new HttpError(401, 'This session belongs to a different EstateFlow app. Please sign in again.', { code: 'wrong_client' });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    if (!user || user.status !== 'Active') throw new HttpError(401, 'Account is inactive or no longer exists', { code: 'inactive' });
    // "Remember me" sessions slide; others keep the absolute expiry set at sign-in.
    const expiresAt = row.remember ? new Date(Date.now() + (await refreshLifetimeMs(true))).toISOString() : row.expires_at;
    const next = await insertRefresh(user.id, client, row.family, !!row.remember, expiresAt, row.device, ip);
    await db.run('UPDATE refresh_tokens SET revoked_at = ?, last_used_at = ?, replaced_by = ? WHERE id = ?', [nowIso(), nowIso(), next.id, row.id]);
    return { accessToken: signAccessToken(user, client), refreshToken: next.token, expiresIn: config.accessTokenMinutes * 60, client, user: publicUser(user) };
  });
}

export async function revokeRefreshToken(refreshToken: string) {
  await db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [nowIso(), sha256(refreshToken)]);
}

/** Ends every session of a user: refresh tokens revoked and outstanding access tokens invalidated (token_version). */
export async function revokeAllSessions(userId: number) {
  await db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
  await db.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  realtime.disconnectUser(userId);
}
