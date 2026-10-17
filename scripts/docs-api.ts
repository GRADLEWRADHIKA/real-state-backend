// Entry for `npm run docs:api`: the route modules open a database on import, so point them at a throwaway file first.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const scratch = path.join(os.tmpdir(), `estateflow-docs-${process.pid}.db`);
process.env.APP_MODE = 'demo';
process.env.VITEST = '1';
process.env.DEMO_DATABASE_FILE = scratch;
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `estateflow-docs-${process.pid}-uploads`);
await import('./gen-api-docs.js');
for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(`${process.env.UPLOAD_DIR}-demo`, { recursive: true, force: true });
process.exit(0);
