/**
 * Generates docs/API.md from the live Express routers (paths, methods, role guards) and the shared
 * zod schemas (request bodies and query strings). Run: npm run docs:api
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as shared from '@estateflow/shared';
import authRoutes from '../src/routes/auth.js';
import auditRoutes from '../src/routes/audit.js';
import customerRequestRoutes from '../src/routes/customerRequests.js';
import dashboardRoutes from '../src/routes/dashboard.js';
import eventRoutes from '../src/routes/events.js';
import leadRoutes from '../src/routes/leads.js';
import customerRoutes, { dealsRouter } from '../src/routes/customers.js';
import propertyRoutes from '../src/routes/properties.js';
import publicRoutes from '../src/routes/public.js';
import siteVisitRoutes from '../src/routes/siteVisits.js';
import followupRoutes from '../src/routes/followups.js';
import taskRoutes from '../src/routes/tasks.js';
import { financeRouter, installmentsRouter, transactionsRouter } from '../src/routes/finance.js';
import documentRoutes from '../src/routes/documents.js';
import notificationRoutes from '../src/routes/notifications.js';
import reportRoutes from '../src/routes/reports.js';
import userRoutes from '../src/routes/users.js';
import settingsRoutes from '../src/routes/settings.js';
import portalRoutes from '../src/routes/portal.js';
import searchRoutes from '../src/routes/search.js';
import brokerRoutes from '../src/routes/brokers.js';
import expenseRoutes from '../src/routes/expenses.js';
import staffRoutes from '../src/routes/staff.js';
import backupRoutes from '../src/routes/backups.js';
import vaultRoutes from '../src/routes/vault.js';

// Mirrors src/app.ts. Every group except auth and public sits behind `authenticate`.
const GROUPS: [string, any, string][] = [
  ['/api/auth', authRoutes, 'Sign-in, token refresh, password reset by admin-issued code, own profile.'],
  ['/api/public', publicRoutes, 'Website lead capture. Authenticated by the `X-Api-Key` generated in Settings → Lead capture.'],
  ['/api/events', eventRoutes, 'Server-sent events: `hello`, `change` (resources to refetch) and `notification`.'],
  ['/api/dashboard', dashboardRoutes, 'KPI dashboard and the field app\'s "my day" view.'],
  ['/api/leads', leadRoutes, 'Leads, pipeline board, duplicates and merge, CSV import/export, conversion to a booking.'],
  ['/api/customers', customerRoutes, 'Customers (bookings), payment schedules and ledgers.'],
  ['/api/deals', dealsRouter, 'Deals (one per booking).'],
  ['/api/properties', propertyRoutes, 'Inventory.'],
  ['/api/site-visits', siteVisitRoutes, 'Site visits with field check-in/check-out.'],
  ['/api/followups', followupRoutes, 'Follow-ups.'],
  ['/api/tasks', taskRoutes, 'Tasks.'],
  ['/api/finance', financeRouter, 'Finance summary.'],
  ['/api/transactions', transactionsRouter, 'Payments and receipts (receipt PDFs are generated on the server).'],
  ['/api/installments', installmentsRouter, 'Installments and recording payments against them.'],
  ['/api/documents', documentRoutes, 'Uploads (size limit, type allowlist, content sniffing) and authorised downloads.'],
  ['/api/notifications', notificationRoutes, 'In-app notifications.'],
  ['/api/reports', reportRoutes, 'Reports and CSV/PDF exports.'],
  ['/api/users', userRoutes, 'Users, staff directory, reset codes, forced sign-out.'],
  ['/api/settings', settingsRoutes, 'Company, lists, notifications, security, lead capture and assignment settings.'],
  ['/api/portal', portalRoutes, 'The customer\'s own view in the app: property, payments, documents and requests.'],
  ['/api/customer-requests', customerRequestRoutes, 'Staff inbox for requests raised in the customer app.'],
  ['/api/audit', auditRoutes, 'Audit log.'],
  ['/api/search', searchRoutes, 'Global search.'],
  ['/api/brokers', brokerRoutes, 'Brokers (channel partners) and the commission worked out automatically on their customers’ payments.'],
  ['/api/expenses', expenseRoutes, 'Site and office expenses, with CSV export.'],
  ['/api/staff', staffRoutes, 'Staff salary (due, paid, left), attendance (self check-in/out and marking) and monthly sales targets.'],
  ['/api/vault', vaultRoutes, 'Office and personal documents of administrators and accounts (never shown to customers or sales).'],
  ['/api/backups', backupRoutes, 'Automatic daily database backups: list, back up now, download (admin, dashboard only).'],
];

// "METHOD path" → [body schema, query schema]
const SCHEMAS: Record<string, [string?, string?]> = {
  'POST /api/auth/login': ['loginBody'],
  'POST /api/auth/refresh': ['refreshBody'],
  'POST /api/auth/forgot-password': ['forgotPasswordBody'],
  'POST /api/auth/reset-password': ['resetPasswordBody'],
  'PUT /api/auth/profile': ['profileBody'],
  'PUT /api/auth/password': ['changePasswordBody'],
  'POST /api/public/leads': ['publicLeadBody'],
  'GET /api/leads': [undefined, 'leadListQuery'],
  'GET /api/leads/export.csv': [undefined, 'leadListQuery'],
  'POST /api/leads': ['leadBody'],
  'PUT /api/leads/:id': ['leadBody'],
  'PATCH /api/leads/:id/status': ['leadStatusBody'],
  'POST /api/leads/:id/notes': ['noteBody'],
  'POST /api/leads/:id/log-contact': ['logContactBody'],
  'POST /api/leads/bulk-assign': ['bulkAssignBody'],
  'POST /api/leads/bulk-delete': ['bulkIdsBody'],
  'POST /api/leads/import': ['leadImportBody'],
  'POST /api/leads/:id/merge': ['mergeLeadBody'],
  'POST /api/leads/:id/convert': ['convertBody'],
  'GET /api/customers': [undefined, 'customerListQuery'],
  'POST /api/customers': ['directBookingBody'],
  'POST /api/customers/schedule-preview': ['schedulePreviewBody'],
  'PUT /api/customers/:id': ['customerUpdateBody'],
  'POST /api/customers/:id/cancel': ['cancelBookingBody'],
  'POST /api/customers/:id/notes': ['customerNoteBody'],
  'GET /api/deals': [undefined, 'dealListQuery'],
  'PATCH /api/deals/:id': ['dealUpdateBody'],
  'GET /api/properties': [undefined, 'propertyListQuery'],
  'POST /api/properties': ['propertyBody'],
  'PUT /api/properties/:id': ['propertyBody'],
  'GET /api/site-visits': [undefined, 'visitListQuery'],
  'POST /api/site-visits': ['visitBody'],
  'PUT /api/site-visits/:id': ['visitBody'],
  'POST /api/site-visits/:id/check-in': ['checkInBody'],
  'POST /api/site-visits/:id/check-out': ['checkOutBody'],
  'GET /api/followups': [undefined, 'followupListQuery'],
  'POST /api/followups': ['followupBody'],
  'PUT /api/followups/:id': ['followupUpdateBody'],
  'GET /api/tasks': [undefined, 'taskListQuery'],
  'POST /api/tasks': ['taskBody'],
  'PUT /api/tasks/:id': ['taskBody'],
  'GET /api/transactions': [undefined, 'transactionListQuery'],
  'POST /api/transactions': ['transactionBody'],
  'PATCH /api/transactions/:id/status': ['transactionStatusBody'],
  'GET /api/installments': [undefined, 'installmentListQuery'],
  'POST /api/installments/:id/payment': ['paymentBody'],
  'GET /api/documents': [undefined, 'documentListQuery'],
  'POST /api/documents': ['documentUploadFields'],
  'GET /api/notifications': [undefined, 'notificationListQuery'],
  'GET /api/reports': [undefined, 'rangeQuery'],
  'GET /api/users': [undefined, 'userListQuery'],
  'POST /api/users': ['userBody'],
  'PUT /api/users/:id': ['userBody'],
  'PATCH /api/users/:id/status': ['userStatusBody'],
  'POST /api/portal/requests': ['customerRequestBody'],
  'POST /api/portal/documents': ['portalUploadFields'],
  'GET /api/customer-requests': [undefined, 'requestListQuery'],
  'PATCH /api/customer-requests/:id': ['customerRequestUpdateBody'],
  'GET /api/audit': [undefined, 'auditListQuery'],
  'GET /api/audit/export.csv': [undefined, 'auditListQuery'],
};

const ALL_ROLES = ['admin', 'manager', 'sales', 'accounts', 'customer'];

interface Row {
  method: string;
  path: string;
  roles: string[];
  flags: string[];
}

function walk(prefix: string, router: any, open: boolean): Row[] {
  const rows: Row[] = [];
  let roles = open ? ['(none)'] : ALL_ROLES;
  const flags: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) {
      if (layer.handle?.roles) roles = roles.filter((r: string) => layer.handle.roles.includes(r));
      if (layer.handle?.name === 'dashboardOnly') flags.push('dashboard only');
      if (layer.handle?.name === 'adminAppReadOnly') flags.push('admin read-only in app');
      continue;
    }
    let routeRoles = roles;
    const routeFlags = [...flags];
    for (const l of layer.route.stack) {
      if (l.handle?.roles) routeRoles = routeRoles.filter((r: string) => l.handle.roles.includes(r));
      if (l.handle?.name === 'dashboardOnly') routeFlags.push('dashboard only');
      if (l.handle?.name === 'adminAppReadOnly') routeFlags.push('admin read-only in app');
      if (l.handle?.name === 'authenticate') routeRoles = ALL_ROLES;
      if (l.handle?.name === 'multerMiddleware') routeFlags.push('multipart: file');
    }
    for (const m of Object.keys(layer.route.methods)) {
      const method = m.toUpperCase();
      const f = [...new Set(routeFlags)].filter((x) => x !== 'admin read-only in app' || method !== 'GET');
      rows.push({ method, path: `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`, roles: routeRoles, flags: f });
    }
  }
  return rows;
}

function describeSchema(name: string): string {
  const schema = (shared as any)[name] as z.ZodType;
  const json: any = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  const req = new Set<string>(json.required ?? []);
  const lines = Object.entries<any>(json.properties ?? {}).map(([k, v]) => {
    const variants = v.anyOf ?? [v];
    const all = [...new Set(variants.map((x: any) => (x.enum ? x.enum.map((e: unknown) => JSON.stringify(e)).join(' \\| ') : x.type ?? 'any')))];
    const types = (all.length > 1 ? all.filter((t) => t !== 'any') : all).join(' \\| ');
    const fmt = variants.map((x: any) => x.pattern || x.format).filter(Boolean)[0];
    return `| \`${k}\` | ${types}${fmt ? ` (${String(fmt).replace(/\|/g, '\\|')})` : ''} | ${req.has(k) ? 'yes' : ''} |`;
  });
  return ['| Field | Type | Required |', '| --- | --- | --- |', ...lines].join('\n');
}

const out: string[] = [
  '# EstateFlow API',
  '',
  '_Generated by `npm run docs:api` from the routers in `src/routes` and the schemas in `shared/src/schemas.ts`. Do not edit by hand._',
  '',
  '## Conventions',
  '',
  '- Base URL: `https://<api-host>/api`. JSON in and out; money is integer rupees; dates are `YYYY-MM-DD`, timestamps ISO-8601.',
  '- Every authenticated request sends `Authorization: Bearer <accessToken>` and `X-EstateFlow-Client: dashboard|app`. The header must match the client the session was issued to.',
  '- Access tokens last `ACCESS_TOKEN_MINUTES` (20). Exchange the refresh token at `POST /auth/refresh`; refresh tokens are single-use and rotate. Replaying a used token ends that sign-in everywhere.',
  '- Lists return `{ data, meta }` with `meta = { page, limit, total, pages, hasMore, nextCursor, … }`. Page with `?page=&limit=` (max 500) or pass `?cursor=<meta.nextCursor>`.',
  '- Errors return `{ error, details?, requestId }`. 401 = sign in again, 403 = not allowed (`details.code` explains: `customer_on_dashboard`, `dashboard_only`, …), 409 = conflict (e.g. `duplicate_phone`), 422 = validation (`"field: message"`), 423 = account locked, 429 = rate limited (see `Retry-After`).',
  '- `X-Request-Id` is returned on every response and written to the logs and the audit trail.',
  '- `GET /api/health` (checks the database) and `GET /api/meta` (`version`, `minAppVersion`, `mode`, `serverTime`) need no authentication.',
  '',
  '## Roles',
  '',
  '`admin`, `manager`, `sales` (sees only records assigned to them), `accounts`, `customer` (app only, own record only). The dashboard refuses `customer`. In the app, administrators can read everything but make configuration and record changes from the dashboard.',
  '',
];

for (const [prefix, router, desc] of GROUPS) {
  const rows = walk(prefix, router, prefix === '/api/public' || prefix === '/api/auth');
  out.push(`## ${prefix.replace('/api/', '')}`, '', desc, '', '| Method | Path | Roles | Body | Query | Notes |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const [body, query] = SCHEMAS[`${r.method} ${r.path}`] ?? [];
    const roles = r.roles.length === ALL_ROLES.length ? 'any signed-in' : r.roles.join(', ');
    out.push(`| ${r.method} | \`${r.path}\` | ${roles} | ${body ? `[${body}](#${body.toLowerCase()})` : ''} | ${query ? `[${query}](#${query.toLowerCase()})` : ''} | ${r.flags.join(', ')} |`);
  }
  out.push('');
}

out.push('## Schemas', '');
const used = [...new Set(Object.values(SCHEMAS).flat().filter(Boolean) as string[])].sort();
for (const name of used) out.push(`### ${name}`, '', describeSchema(name), '');

out.push(
  '## Server-sent events',
  '',
  '`GET /api/events` streams `text/event-stream`. Read it with `fetch` so the usual headers are sent (the shared API client does this and reconnects with backoff).',
  '',
  '```',
  'event: change',
  'data: {"type":"change","resources":["leads","followups"],"at":"2026-10-17T10:00:00.000Z"}',
  '',
  'event: notification',
  'data: {"type":"notification","notification":{"id":42,"title":"New lead assigned",…},"resources":["notifications"],"at":"…"}',
  '```',
  '',
  'Resources: ' + shared.REALTIME_RESOURCES.map((r) => `\`${r}\``).join(', ') + '. Customers only receive events about their own records.',
  '',
);

const target = path.resolve(import.meta.dirname, '../docs/API.md');
fs.writeFileSync(target, out.join('\n'));
console.log(`Wrote ${path.relative(process.cwd(), target)} (${GROUPS.length} groups)`);
