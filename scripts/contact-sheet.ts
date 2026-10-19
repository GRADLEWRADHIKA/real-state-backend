/**
 * Renders every view for three sample properties of different types into one contact sheet
 * (docs/image-samples/contact-sheet.png) for reviewing generator quality.
 *   npx tsx scripts/contact-sheet.ts [out.png] [seed]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildSceneSpecs, type PropertyFacts } from '../src/images/scene/spec.js';
import { renderWebp } from '../src/images/render.js';

const out = process.argv[2] ?? path.resolve(import.meta.dirname, '../docs/image-samples/contact-sheet.png');
const seed = Number(process.argv[3] ?? 1);
const base = { city: 'Lucknow', project: 'Green Valley', status: 'Available', amenities: ['Swimming pool', 'Clubhouse', 'Gymnasium', 'Kids play area', 'Landscaped parks'] };
const samples: PropertyFacts[] = [
  { ...base, id: 21, slug: 'green-valley-residency-a-702', name: '3 BHK Apartment', type: 'Apartment', unit_number: 'A-702', floor: 7, bedrooms: 3, area_sqft: 1420 },
  { ...base, id: 14, slug: 'green-valley-villas-v-14', name: '4 BHK Premium Villa', type: 'Villa', unit_number: 'V-14', bedrooms: 4, area_sqft: 2600, status: 'Booked' },
  { ...base, id: 7, slug: 'green-valley-plots-b-15', name: '2,000 sq ft Residential Plot', type: 'Plot', unit_number: 'B-15', area_sqft: 2000 },
  { ...base, id: 30, slug: 'green-valley-commercial-o-201', name: 'Office Space', type: 'Office', unit_number: 'O-201', floor: 2, area_sqft: 850 },
];
const which = (process.env.SHEET_TYPES ?? 'Apartment,Villa,Plot').split(',');
const TW = 400;
const TH = 300;
const rows: Buffer[][] = [];
for (const p of samples.filter((s) => which.includes(s.type))) {
  const row: Buffer[] = [];
  for (const spec of buildSceneSpecs(p, seed)) {
    const t = Date.now();
    const buf = await renderWebp(spec);
    console.log(p.type.padEnd(10), spec.view.padEnd(18), `${spec.width}x${spec.height}`, `${Math.round(buf.length / 1024)} KB`, `${Date.now() - t} ms`);
    row.push(await sharp(buf).resize(TW, TH, { fit: 'cover' }).png().toBuffer());
  }
  rows.push(row);
}
const cols = Math.max(...rows.map((r) => r.length));
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: cols * (TW + 8) + 8, height: rows.length * (TH + 8) + 8, channels: 3, background: '#062419' } })
  .composite(rows.flatMap((row, y) => row.map((input, x) => ({ input, left: 8 + x * (TW + 8), top: 8 + y * (TH + 8) }))))
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log('wrote', out);
