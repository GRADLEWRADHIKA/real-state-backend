/** Plot: illustrated top-down amenities map: roads, plot blocks, park, clubhouse, pool, play area and gate, with the subject plot pinned. */
import { mix, shade } from '../scene/color.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function amenitiesMap(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const W = s.width;
  const H = s.height;
  const grass = mix(pal.grass, '#a9c58a', 0.35);
  svg.add(`<rect width="${W}" height="${H}" fill="${grass}"/>`);
  const shadow = svg.blur(4);
  let g = '';
  const road = '#e9e2d4';
  // Ring road and spines.
  g += `<rect x="60" y="60" width="${W - 120}" height="${H - 120}" rx="40" fill="none" stroke="${road}" stroke-width="34"/>`;
  const cols = [W * 0.36, W * 0.64];
  const rows = [H * 0.4, H * 0.68];
  for (const x of cols) g += `<line x1="${x}" y1="60" x2="${x}" y2="${H - 60}" stroke="${road}" stroke-width="24"/>`;
  for (const y of rows) g += `<line x1="60" y1="${y}" x2="${W - 60}" y2="${y}" stroke="${road}" stroke-width="24"/>`;
  g += `<line x1="${W / 2}" y1="${H - 60}" x2="${W / 2}" y2="${H}" stroke="${road}" stroke-width="40"/>`;
  // Blocks: plots everywhere except the central park block and the clubhouse block.
  const xs = [80, cols[0] + 12, cols[1] + 12, W - 80];
  const ys = [80, rows[0] + 12, rows[1] + 12, H - 80];
  const earth = mix('#d8bf98', pal.sun, 0.1);
  let subjectPin: [number, number] | null = null;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x0 = xs[i] + (i ? 0 : 0);
      const x1 = (i < 2 ? [cols[0], cols[1]][i] : W - 80) - 12;
      const y0 = ys[j];
      const y1 = (j < 2 ? [rows[0], rows[1]][j] : H - 80) - 12;
      if (i === 1 && j === 1) {
        // Central park with a path loop and trees.
        g += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="16" fill="${mix(grass, '#7fae5e', 0.5)}"/>`;
        g += `<ellipse cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" rx="${(x1 - x0) * 0.36}" ry="${(y1 - y0) * 0.32}" fill="none" stroke="${BRAND.stoneLight}" stroke-width="6"/>`;
        continue;
      }
      if (i === 2 && j === 2) {
        // Clubhouse, pool and play area.
        g += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="12" fill="${mix(grass, BRAND.stoneLight, 0.4)}"/>`;
        g += `<rect x="${x0 + 22}" y="${y0 + 18}" width="${(x1 - x0) * 0.45}" height="${(y1 - y0) * 0.5}" fill="#000" opacity="0.25" filter="${shadow}" transform="translate(6,6)"/><rect x="${x0 + 22}" y="${y0 + 18}" width="${(x1 - x0) * 0.45}" height="${(y1 - y0) * 0.5}" rx="4" fill="${BRAND.green}"/>`;
        g += `<rect x="${x0 + (x1 - x0) * 0.58}" y="${y0 + 22}" width="${(x1 - x0) * 0.34}" height="${(y1 - y0) * 0.36}" rx="6" fill="#5fb3c1" stroke="#fff" stroke-width="5"/>`;
        g += `<circle cx="${x0 + (x1 - x0) * 0.3}" cy="${y1 - (y1 - y0) * 0.22}" r="${(y1 - y0) * 0.14}" fill="#c9705a"/>`;
        continue;
      }
      g += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="6" fill="${earth}"/>`;
      const n = Math.max(3, Math.round((x1 - x0) / 46));
      const pw = (x1 - x0) / n;
      for (let k = 0; k < n; k++)
        for (const half of [0, 1]) {
          const px = x0 + k * pw;
          const py = y0 + half * ((y1 - y0) / 2);
          const subject = i === 0 && j === 1 && half === 0 && k === 1;
          if (subject) subjectPin = [px + pw / 2, py + (y1 - y0) / 4];
          g += `<rect x="${px + 2}" y="${py + 2}" width="${pw - 4}" height="${(y1 - y0) / 2 - 4}" fill="${subject ? BRAND.brassLight : r.chance(0.3) ? shade(earth, 0.93) : earth}" stroke="${subject ? BRAND.brass : '#fff'}" stroke-width="${subject ? 4 : 1.2}"/>`;
          if (!subject && r.chance(0.22)) g += `<rect x="${px + pw * 0.22 + 4}" y="${py + 14}" width="${pw * 0.56}" height="${(y1 - y0) / 4}" fill="#000" opacity="0.2" filter="${shadow}"/><rect x="${px + pw * 0.22}" y="${py + 10}" width="${pw * 0.56}" height="${(y1 - y0) / 4}" fill="${BRAND.stoneLight}" stroke="${BRAND.stoneDark}" stroke-width="1"/>`;
        }
    }
  svg.add(g);
  // Trees along every road and in the park.
  let t = '';
  const treeAt = (x: number, y: number, rr: number) => {
    const c = r.pick(pal.foliage);
    t += `<circle cx="${x + rr * 0.35}" cy="${y + rr * 0.45}" r="${rr}" fill="#000" opacity="0.22"/><circle cx="${x}" cy="${y}" r="${rr}" fill="${c}"/><circle cx="${x - rr * 0.3}" cy="${y - rr * 0.3}" r="${rr * 0.5}" fill="${mix(c, pal.sun, 0.35)}"/>`;
  };
  for (let x = 90; x < W - 80; x += 34) for (const y of [38, H - 38]) treeAt(x + r.range(-4, 4), y, r.range(9, 13));
  for (let y = 90; y < H - 80; y += 34) for (const x of [38, W - 38]) treeAt(x, y + r.range(-4, 4), r.range(9, 13));
  for (let k = 0; k < 40 * s.treeDensity; k++) treeAt(xs[1] + r.range(10, cols[1] - 12 - xs[1] - 10), ys[1] + r.range(10, rows[1] - 12 - ys[1] - 10), r.range(8, 15));
  svg.add(t);
  // Entrance gate at the bottom.
  svg.add(`<rect x="${W / 2 - 46}" y="${H - 40}" width="16" height="16" fill="${BRAND.green}"/><rect x="${W / 2 + 30}" y="${H - 40}" width="16" height="16" fill="${BRAND.green}"/><rect x="${W / 2 - 46}" y="${H - 36}" width="92" height="6" fill="${BRAND.brass}"/>`);
  // Pin over the subject plot.
  if (subjectPin) {
    const [px, py] = subjectPin;
    svg.add(`<g transform="translate(${px},${py})"><ellipse cx="0" cy="2" rx="10" ry="4" fill="#000" opacity="0.3"/><path d="M0,0 C-16,-22 -18,-34 -18,-42 A18,18 0 1 1 18,-42 C18,-34 16,-22 0,0 Z" fill="${BRAND.green}" stroke="#fff" stroke-width="3"/><circle cx="0" cy="-42" r="7" fill="${BRAND.brassLight}"/></g>`);
  }
  // Paper grain wash and north arrow.
  svg.add(`<rect width="${W}" height="${H}" fill="${pal.sun}" opacity="0.06"/><g transform="translate(${W - 110},${110})"><circle r="24" fill="${BRAND.paper}" opacity="0.9"/><path d="M0,-18 L7,8 L0,3 L-7,8 Z" fill="${BRAND.green}"/></g>`);
  return svg.toString();
}
