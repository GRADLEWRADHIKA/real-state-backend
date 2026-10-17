import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { CLIENT_ACCESS, CLIENT_HEADER, CLIENTS, CUSTOMER_DASHBOARD_MESSAGE, type ClientKind, type Role } from '@estateflow/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  customer_id: number | null;
  /** Front-end the session was issued to (JWT `cl` claim). */
  client: ClientKind;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthUser;
      requestId: string;
    }
  }
}

interface AccessClaims extends jwt.JwtPayload {
  cl: ClientKind;
  tv: number;
}

export function signAccessToken(user: { id: number; token_version: number }, client: ClientKind) {
  return jwt.sign({ sub: String(user.id), cl: client, tv: user.token_version ?? 0 }, config.jwtSecret, {
    expiresIn: config.accessTokenMinutes * 60,
    issuer: 'estateflow',
  });
}

/** Front-end named by the request header (required on every authenticated call). */
export function requestClient(req: Request): ClientKind | null {
  const v = String(req.headers[CLIENT_HEADER.toLowerCase()] ?? '').toLowerCase();
  return (CLIENTS as readonly string[]).includes(v) ? (v as ClientKind) : null;
}

/** Roles a front-end accepts, with the user-facing reason when it does not. */
export function assertRoleOnClient(role: Role, client: ClientKind) {
  if (CLIENT_ACCESS[client].includes(role)) return;
  if (role === 'customer' && client === 'dashboard') throw new HttpError(403, CUSTOMER_DASHBOARD_MESSAGE, { code: 'customer_on_dashboard' });
  throw new HttpError(403, `This account cannot sign in to the ${client}.`, { code: 'role_not_allowed' });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');
  let claims: AccessClaims;
  try {
    claims = jwt.verify(header.slice(7), config.jwtSecret, { issuer: 'estateflow' }) as AccessClaims;
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.', { code: 'token_expired' });
  }
  const client = requestClient(req);
  if (!client || !claims.cl || client !== claims.cl) {
    throw new HttpError(401, 'This session belongs to a different EstateFlow app. Please sign in again.', { code: 'wrong_client' });
  }
  const user = await db.get<Omit<AuthUser, 'client'> & { status: string; token_version: number }>(
    'SELECT id, name, email, role, customer_id, status, token_version FROM users WHERE id = ?',
    [Number(claims.sub)],
  );
  if (!user || user.status !== 'Active') throw new HttpError(401, 'Account is inactive or no longer exists', { code: 'inactive' });
  if ((user.token_version ?? 0) !== (claims.tv ?? 0)) throw new HttpError(401, 'You were signed out. Please sign in again.', { code: 'revoked' });
  assertRoleOnClient(user.role, client);
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role, customer_id: user.customer_id, client };
  next();
}

export function authorize(...roles: Role[]) {
  const guard = (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission to access this resource');
    next();
  };
  // Read by scripts/gen-api-docs.ts to list each route's roles.
  return Object.assign(guard, { roles });
}

/** Configuration and bulk operations are only offered in the dashboard; the app is read-mostly for admins. */
export function dashboardOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.user.client !== 'dashboard') throw new HttpError(403, 'This action is only available in the EstateFlow dashboard.', { code: 'dashboard_only' });
  next();
}

/** The admin app is read-mostly: writes by admins from the app are limited to the routes that opt in. */
export function adminAppReadOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.user.role === 'admin' && req.user.client === 'app' && req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(403, 'Administrators can make this change from the dashboard.', { code: 'dashboard_only' });
  }
  next();
}

/** Sales executives only see records assigned to them. */
export const isScoped = (u: AuthUser) => u.role === 'sales';
export function scope(u: AuthUser, column: string): { sql: string; params: unknown[] } {
  return isScoped(u) ? { sql: ` AND ${column} = ?`, params: [u.id] } : { sql: '', params: [] };
}
