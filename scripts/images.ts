/**
 * Property image generator CLI.
 *   npm run images:generate -- [--property <slug|id>] [--all] [--force] [--seed N]
 *                              [--provider procedural|local-diffusion|folder] [--sd-url URL] [--photos] [--production]
 *   npm run images:import -- --property <slug|id>     (same as --provider folder)
 * Works on the demo database unless --production is given (then server/.env applies).
 */
if (!process.argv.includes('--production') && !process.argv.includes('--demo')) process.argv.push('--demo');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const { db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/init.js');
const { generateForProperty } = await import('../src/images/generate.js');
type Provider = 'procedural' | 'folder' | 'local-diffusion';

const provider = (value('provider') ?? (flag('import') ? 'folder' : 'procedural')) as Provider;
if (!['procedural', 'folder', 'local-diffusion'].includes(provider)) {
  console.error(`Unknown provider "${provider}". Use procedural, folder or local-diffusion.`);
  process.exit(2);
}
const which = value('property');
if (!which && !flag('all')) {
  console.error('Pass --property <slug|id> or --all.');
  process.exit(2);
}
await migrate();
const { config } = await import('../src/config.js');
if (config.isDemo) await (await import('../src/db/demo-seed.js')).seedDemoIfEmpty();
const rows = which
  ? await db.all<{ id: number; slug: string }>('SELECT id, slug FROM properties WHERE slug = ? OR id = ?', [which, Number(which) || -1])
  : await db.all<{ id: number; slug: string }>('SELECT id, slug FROM properties ORDER BY id');
if (!rows.length) {
  console.error(which ? `No property matches "${which}".` : 'There are no properties yet.');
  process.exit(1);
}
const seed = value('seed') !== undefined ? Number(value('seed')) : 1;
const started = Date.now();
let total = 0;
let failed = 0;
for (const r of rows) {
  try {
    const t = Date.now();
    const res = await generateForProperty(r.id, { provider, seed, force: flag('force') || provider !== 'procedural', sdUrl: value('sd-url'), photos: flag('photos'), log: console.log });
    total += res.imported;
    console.log(res.skipped ? `- ${r.slug}: skipped (already has generated images; use --force)` : `✓ ${r.slug}: ${res.imported} images (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${r.slug}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${total} images imported for ${rows.length - failed} of ${rows.length} properties in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
db.close();
process.exit(failed ? 1 : 0);
