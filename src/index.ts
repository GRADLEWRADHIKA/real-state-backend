import { config } from './config.js';
import { db } from './db/index.js';
import { assertDatabaseMatchesMode, ensureAdmin, migrate } from './db/init.js';
import { createApp } from './app.js';
import { log } from './logger.js';
import { syncInstallmentStatuses } from './services/payments.js';
import { realtime } from './services/realtime.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

try {
  await assertDatabaseMatchesMode();
  await migrate();
  if (config.isDemo) {
    const { seedDemoIfEmpty } = await import('./db/demo-seed.js');
    await seedDemoIfEmpty();
  } else {
    await ensureAdmin();
  }
  await syncInstallmentStatuses(true);
} catch (err) {
  log.error('startup failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

const app = createApp();
const onListen = () => {
  log.info('EstateFlow API listening', { mode: config.mode, host: config.host ?? 'default', port: config.port, db: config.dbFile, version: config.version });
};
const server = config.host ? app.listen(config.port, config.host, onListen) : app.listen(config.port, onListen);
server.on('error', (err: NodeJS.ErrnoException) => {
  log.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Set PORT to a free port.` : 'server error', { error: err.message });
  process.exit(1);
});
startScheduler();

// Demo galleries: illustrate every property that has no images yet (cached under design/ai-images,
// so this is quick after the first run). Production never generates anything on its own.
if (config.isDemo && process.env.DEMO_IMAGES !== '0') {
  const { generateInBackground } = await import('./images/generate.js');
  const ids = (await db.all<{ id: number }>('SELECT id FROM properties p WHERE NOT EXISTS (SELECT 1 FROM property_images i WHERE i.property_id = p.id) ORDER BY id')).map((r) => r.id);
  if (ids.length) {
    log.info('preparing demo property images in the background', { properties: ids.length });
    void generateInBackground(ids, { log: (m) => log.info(m), onDone: () => realtime.change(['properties'], { staffOnly: true }) });
  }
}

/** Graceful shutdown: stop accepting work, end SSE streams, let in-flight requests finish, then close the DB. */
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  stopScheduler();
  realtime.closeAll();
  server.close(() => {
    db.close();
    log.info('stopped');
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => {
    log.warn('forcing exit after 10s');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
