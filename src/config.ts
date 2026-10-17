import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_VERSION } from '@estateflow/shared';

dotenv.config({ quiet: true });
process.env.TZ ||= 'Asia/Kolkata';

const root = path.resolve(import.meta.dirname, '..');
const isDemo = process.argv.includes('--demo') || process.env.APP_MODE === 'demo';
const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

function resolveSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (!isDemo && !isTest) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters. Set it in server/.env before starting in production.');
  }
  if (!isTest) console.warn('[config] JWT_SECRET not set — using a temporary secret for this demo session.');
  return crypto.randomBytes(48).toString('hex');
}

const int = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : d);
const list = (v: string | undefined, d: string) =>
  (v || d)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Origins every deployment needs: Capacitor Android (https://localhost), iOS (capacitor://localhost) and local dev. */
const BASE_ORIGINS = 'https://localhost,capacitor://localhost,http://localhost,http://localhost:7340,http://localhost:7342';

export const config = {
  mode: (isDemo ? 'demo' : 'production') as 'demo' | 'production',
  isDemo,
  isTest,
  version: APP_VERSION,
  /** Oldest app build allowed to talk to this API; older builds show "update required". */
  minAppVersion: process.env.MIN_APP_VERSION?.trim() || '2.0.0',
  port: int(process.env.PORT, 7341),
  dbFile: path.resolve(
    root,
    isDemo ? process.env.DEMO_DATABASE_FILE || 'data/estateflow-demo.db' : process.env.DATABASE_FILE || 'data/estateflow.db',
  ),
  // Demo uploads always live in their own folder, next to (never inside) production files.
  uploadDir: path.resolve(root, isDemo ? `${process.env.UPLOAD_DIR || 'uploads'}-demo` : process.env.UPLOAD_DIR || 'uploads/app'),
  uploadMaxBytes: int(process.env.UPLOAD_MAX_MB, 10) * 1024 * 1024,
  jwtSecret: resolveSecret(),
  accessTokenMinutes: int(process.env.ACCESS_TOKEN_MINUTES, 20),
  refreshRememberDays: int(process.env.REFRESH_REMEMBER_DAYS, 30),
  /** Production allows only the listed origins (plus the Capacitor/localhost ones); demo additionally allows LAN devices. */
  corsOrigins: [...new Set([...list(process.env.CORS_ORIGINS, ''), ...BASE_ORIGINS.split(',')])],
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    api: int(process.env.RATE_LIMIT_API, 600),
    auth: int(process.env.RATE_LIMIT_AUTH, 20),
    publicLeads: int(process.env.RATE_LIMIT_PUBLIC_LEADS, 30),
  },
  schedulerIntervalMs: int(process.env.SCHEDULER_INTERVAL_MS, 5 * 60_000),
  logLevel: (process.env.LOG_LEVEL || (isTest ? 'silent' : 'info')) as 'debug' | 'info' | 'warn' | 'error' | 'silent',
  assetsDir: path.resolve(root, 'assets'),
  /** Built dashboard served by the API for single-origin installs (optional; Netlify is the default host). */
  dashboardDist: path.resolve(root, process.env.DASHBOARD_DIST || '../estateflow-dashboard/dist'),
  companyName: process.env.COMPANY_NAME?.trim() || '',
  bootstrapAdmin: {
    name: process.env.ADMIN_NAME?.trim() || 'Administrator',
    email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
};
