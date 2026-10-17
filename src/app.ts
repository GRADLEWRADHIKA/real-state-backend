import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_HEADER } from '@estateflow/shared';
import { config } from './config.js';
import { db } from './db/index.js';
import { authenticate } from './middleware/auth.js';
import { auditAndBroadcast, requestContext } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { rateLimit } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import auditRoutes from './routes/audit.js';
import customerRequestRoutes from './routes/customerRequests.js';
import dashboardRoutes from './routes/dashboard.js';
import eventRoutes from './routes/events.js';
import leadRoutes from './routes/leads.js';
import customerRoutes, { dealsRouter } from './routes/customers.js';
import propertyRoutes from './routes/properties.js';
import publicRoutes from './routes/public.js';
import siteVisitRoutes from './routes/siteVisits.js';
import followupRoutes from './routes/followups.js';
import taskRoutes from './routes/tasks.js';
import { financeRouter, installmentsRouter, transactionsRouter } from './routes/finance.js';
import documentRoutes from './routes/documents.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import portalRoutes from './routes/portal.js';
import searchRoutes from './routes/search.js';

const toMatcher = (o: string) => (o.includes('*') ? new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i') : o);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // Website lead capture is called from any site that holds the API key; no cookies are involved.
  app.use('/api/public', cors({ origin: true, methods: ['POST'], allowedHeaders: ['Content-Type', 'X-Api-Key'], maxAge: 86400 }));

  // Auth uses bearer tokens, not cookies. Production allows only CORS_ORIGINS plus the Capacitor/localhost
  // origins; wildcards such as https://*.netlify.app are accepted. Demo mode also accepts LAN devices.
  const allowed = config.corsOrigins.map(toMatcher);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.isDemo) return cb(null, true);
        cb(null, allowed.some((a) => (typeof a === 'string' ? a === origin : a.test(origin))));
      },
      allowedHeaders: ['Content-Type', 'Authorization', CLIENT_HEADER, 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Retry-After'],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  /** Liveness + readiness: touches the database so a broken volume shows up as unhealthy. */
  app.get('/api/health', async (_req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ ok: true, db: 'ok', uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ ok: false, db: 'unavailable' });
    }
  });
  app.get('/api/meta', (_req, res) =>
    res.json({ app: 'EstateFlow CRM', mode: config.mode, version: config.version, minAppVersion: config.minAppVersion, serverTime: new Date().toISOString() }),
  );

  const apiLimiter = rateLimit({ name: 'api', windowMs: config.rateLimit.windowMs, max: () => config.rateLimit.api });
  app.use('/api', apiLimiter);
  app.use('/api', auditAndBroadcast);
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);

  const api = express.Router();
  api.use(authenticate);
  api.use('/events', eventRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/leads', leadRoutes);
  api.use('/customers', customerRoutes);
  api.use('/deals', dealsRouter);
  api.use('/properties', propertyRoutes);
  api.use('/site-visits', siteVisitRoutes);
  api.use('/followups', followupRoutes);
  api.use('/tasks', taskRoutes);
  api.use('/finance', financeRouter);
  api.use('/transactions', transactionsRouter);
  api.use('/installments', installmentsRouter);
  api.use('/documents', documentRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/reports', reportRoutes);
  api.use('/users', userRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/portal', portalRoutes);
  api.use('/customer-requests', customerRequestRoutes);
  api.use('/audit', auditRoutes);
  api.use('/search', searchRoutes);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // Optional single-origin install: serve the built dashboard when it exists next to the server.
  if (fs.existsSync(path.join(config.dashboardDist, 'index.html'))) {
    app.use(express.static(config.dashboardDist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(config.dashboardDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
