// Rebuilds the DEMO database from scratch: npm run seed:demo
import fs from 'node:fs';
import { config } from '../config.js';

if (!config.isDemo) {
  console.error('Refusing to seed: demo data can only be loaded into the demo database (run with --demo).');
  process.exit(1);
}
for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });

const { migrate } = await import('./init.js');
const { seedDemoIfEmpty } = await import('./demo-seed.js');
await migrate();
await seedDemoIfEmpty();
console.log(`Demo database rebuilt at ${config.dbFile}`);
