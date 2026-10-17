import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Runs before any app module is imported: every test file gets a private database and upload folder.
const dir = path.join(os.tmpdir(), `estateflow-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
process.env.DEMO_DATABASE_FILE = path.join(dir, 'test.db');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.RATE_LIMIT_AUTH = '10000';
process.env.RATE_LIMIT_API = '100000';
process.env.SCHEDULER_INTERVAL_MS = '0';
process.env.LOG_LEVEL = 'silent';
