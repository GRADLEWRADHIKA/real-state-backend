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

const server = createApp().listen(config.port, () => {
  log.info('EstateFlow API listening', { mode: config.mode, port: config.port, db: config.dbFile, version: config.version });
});
server.on('error', (err: NodeJS.ErrnoException) => {
  log.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Set PORT to a free port.` : 'server error', { error: err.message });
  process.exit(1);
});
startScheduler();

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
