/** Dev helper: renders views of one sample property to a folder. tsx scripts/preview-scene.ts <type> <outdir> [seed] [views] */
import fs from 'node:fs';
import path from 'node:path';
import { buildSceneSpecs } from '../src/images/scene/spec.js';
import { renderWebp } from '../src/images/render.js';

const [type = 'Apartment', out = 'preview', seed = '1', only = ''] = process.argv.slice(2);
const specs = buildSceneSpecs({ id: 7, slug: `sample-${type.toLowerCase()}`, name: `Sample ${type}`, type, project: 'Green Valley', city: 'Lucknow', unit_number: 'A-702', floor: 7, bedrooms: 3, bathrooms: 3, area_sqft: 1420, status: 'Available', amenities: ['Swimming pool', 'Clubhouse', 'Gymnasium', 'Kids play area', 'Landscaped parks', 'Gated entry with security'] }, Number(seed));
fs.mkdirSync(out, { recursive: true });
for (const s of specs) {
  if (only && !only.split(',').includes(s.view)) continue;
  const t = Date.now();
  try {
    const buf = await renderWebp(s);
    fs.writeFileSync(path.join(out, `${String(s.index + 1).padStart(2, '0')}-${s.view}.webp`), buf);
    console.log(s.view, `${Math.round(buf.length / 1024)} KB`, `${Date.now() - t} ms`);
  } catch (e) {
    console.log(s.view, 'skip', (e as Error).message);
  }
}
