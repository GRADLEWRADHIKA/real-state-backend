/** Floor plan: top-down layout with room labels and areas, derived from bedrooms and area. Commercial units get an open floor around a core. */
import { mix, shade } from '../scene/color.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { categoryOf } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

type Use = 'living' | 'bed' | 'bath' | 'kitchen' | 'balcony' | 'utility' | 'open' | 'core' | 'store';
interface RoomRect { x: number; y: number; w: number; h: number; label: string; use: Use }

const FILL: Record<Use, string> = {
  living: '#efe6d4', bed: '#e3cfae', bath: '#d5dfdf', kitchen: '#e9e0cf', balcony: '#dfe6d3', utility: '#e3e1da', open: '#ece4d4', core: '#d6d1c7', store: '#e3e1da',
};

/** Rooms in unit coordinates (0..1) for a residence with n bedrooms. */
function residence(n: number): RoomRect[] {
  const beds = Math.max(1, Math.min(4, n));
  const rooms: RoomRect[] = [];
  const topH = 0.44;
  const bw = 1 / beds;
  for (let i = 0; i < beds; i++) {
    const bathW = bw * 0.36;
    const master = i === 0;
    rooms.push({ x: i * bw, y: 0, w: bw - (master || i === beds - 1 ? bathW : 0), h: topH, label: master ? 'Master bedroom' : `Bedroom ${i + 1}`, use: 'bed' });
    if (master || i === beds - 1) rooms.push({ x: i * bw + bw - bathW, y: 0, w: bathW, h: topH * 0.55, label: 'Bath', use: 'bath' });
  }
  rooms.push({ x: 0, y: topH, w: 0.58, h: 0.46, label: 'Living & dining', use: 'living' });
  rooms.push({ x: 0.58, y: topH, w: 0.26, h: 0.3, label: 'Kitchen', use: 'kitchen' });
  rooms.push({ x: 0.84, y: topH, w: 0.16, h: 0.3, label: 'Utility', use: 'utility' });
  rooms.push({ x: 0.58, y: topH + 0.3, w: 0.42, h: 0.16, label: 'Foyer', use: 'living' });
  rooms.push({ x: 0, y: 0.9, w: 0.58, h: 0.1, label: 'Balcony', use: 'balcony' });
  return rooms;
}

function commercial(type: string): RoomRect[] {
  const shop = type === 'Shop' || type === 'Commercial';
  return [
    { x: 0, y: 0, w: 0.74, h: 1, label: shop ? 'Retail floor' : 'Open office', use: 'open' },
    { x: 0.74, y: 0, w: 0.26, h: 0.34, label: shop ? 'Store' : 'Meeting', use: 'store' },
    { x: 0.74, y: 0.34, w: 0.26, h: 0.3, label: shop ? 'Back office' : 'Pantry', use: 'kitchen' },
    { x: 0.74, y: 0.64, w: 0.26, h: 0.36, label: 'Toilet', use: 'bath' },
  ];
}

export default function floorPlan(s: SceneSpec, r: Rng) {
  const svg = new Svg(s.width, s.height);
  const p = s.property;
  const cat = categoryOf(p.type);
  const paper = BRAND.paper;
  svg.add(`<rect width="${s.width}" height="${s.height}" fill="${paper}"/>`);
  // Faint drafting grid.
  let grid = '';
  for (let x = 0; x < s.width; x += 30) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${s.height}"/>`;
  for (let y = 0; y < s.height; y += 30) grid += `<line x1="0" y1="${y}" x2="${s.width}" y2="${y}"/>`;
  svg.add(`<g stroke="${shade(paper, 0.94)}" stroke-width="1">${grid}</g>`);

  const villa = cat === 'villa';
  const carpet = p.area_sqft * (cat === 'commercial' ? 0.8 : 0.76);
  const plans: { rooms: RoomRect[]; area: number }[] = [];
  if (cat === 'commercial') plans.push({ rooms: commercial(p.type), area: carpet });
  else if (villa) {
    const n = p.bedrooms ?? 3;
    plans.push({ rooms: residence(1), area: carpet * 0.55 });
    plans.push({ rooms: residence(Math.max(1, n - 1)).map((q) => (q.use === 'living' && q.label === 'Living & dining' ? { ...q, label: 'Family lounge' } : q.label === 'Kitchen' ? { ...q, label: 'Study', use: 'living' as Use } : q.label === 'Balcony' ? { ...q, label: 'Terrace' } : q)), area: carpet * 0.45 });
  } else plans.push({ rooms: residence(p.bedrooms ?? 2), area: carpet });

  const margin = 70;
  const gap = 60;
  const availW = (s.width - margin * 2 - gap * (plans.length - 1)) / plans.length;
  const availH = s.height - margin * 2 - 30;
  const aspect = cat === 'commercial' ? r.range(1.25, 1.5) : r.range(1.15, 1.35);
  const W = Math.min(availW, availH * aspect);
  const H = W / aspect;
  plans.forEach((plan, pi) => {
    const ox = margin + pi * (availW + gap) + (availW - W) / 2;
    const oy = margin + (availH - H) / 2;
    const total = plan.rooms.reduce((a, q) => a + q.w * q.h, 0);
    let s2 = '';
    // Soft drop shadow under the plan.
    s2 += `<rect x="${ox + 8}" y="${oy + 10}" width="${W}" height="${H}" fill="#000" opacity="0.08" filter="${svg.blur(8)}"/>`;
    for (const q of plan.rooms) {
      const x = ox + q.x * W;
      const y = oy + q.y * H;
      const w = q.w * W;
      const h = q.h * H;
      s2 += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${FILL[q.use]}"/>`;
      if (q.use === 'bed') {
        for (let k = 0; k < w; k += 9) s2 += `<line x1="${x + k}" y1="${y}" x2="${x + k}" y2="${y + h}" stroke="${shade(FILL.bed, 0.92)}" stroke-width="1"/>`;
        const bw = Math.min(w * 0.55, 110);
        const bh = Math.min(h * 0.55, 130);
        const bx = x + (w - bw) / 2;
        s2 += `<rect x="${bx}" y="${y + 14}" width="${bw}" height="${bh}" rx="4" fill="#fbf8f2" stroke="${BRAND.stoneDark}" stroke-width="1.5"/><rect x="${bx + 6}" y="${y + 20}" width="${bw / 2 - 9}" height="${bh * 0.16}" rx="3" fill="${mix(s.pal.accent, '#ffffff', 0.5)}"/><rect x="${bx + bw / 2 + 3}" y="${y + 20}" width="${bw / 2 - 9}" height="${bh * 0.16}" rx="3" fill="${mix(s.pal.accent, '#ffffff', 0.5)}"/>`;
      } else if (q.use === 'bath') {
        for (let k = 0; k < w; k += 12) for (let j = 0; j < h; j += 12) s2 += `<rect x="${x + k}" y="${y + j}" width="11" height="11" fill="none" stroke="${shade(FILL.bath, 0.92)}" stroke-width="1"/>`;
        s2 += `<ellipse cx="${x + w * 0.3}" cy="${y + h * 0.7}" rx="${Math.min(10, w * 0.15)}" ry="${Math.min(13, h * 0.15)}" fill="#fff" stroke="${BRAND.stoneDark}"/>`;
      } else if (q.label.startsWith('Living')) {
        s2 += `<path d="M${x + 20},${y + h - 30} h${w * 0.4} v-24 h-${w * 0.4 - 24} v-${h * 0.3} h-24 Z" fill="${mix(BRAND.green3, '#ffffff', 0.55)}" stroke="${BRAND.green3}" stroke-width="1.5"/>`;
        s2 += `<circle cx="${x + w * 0.74}" cy="${y + h * 0.42}" r="${Math.min(w, h) * 0.13}" fill="#fff" stroke="${BRAND.stoneDark}" stroke-width="1.5"/>`;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.78;
          const rr = Math.min(w, h) * 0.13 + 9;
          s2 += `<circle cx="${x + w * 0.74 + Math.cos(a) * rr}" cy="${y + h * 0.42 + Math.sin(a) * rr}" r="6" fill="${mix(s.pal.accent, '#ffffff', 0.4)}"/>`;
        }
      } else if (q.use === 'kitchen' && q.label === 'Kitchen') {
        s2 += `<path d="M${x + 4},${y + 4} h${w - 8} v14 h-${w - 26} v${h - 22} h-14 Z" fill="#fff" stroke="${BRAND.stoneDark}" stroke-width="1.5"/>`;
      } else if (q.use === 'open') {
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) s2 += `<rect x="${x + w * (0.12 + k * 0.28)}" y="${y + h * (0.15 + j * 0.27)}" width="${w * 0.2}" height="${h * 0.1}" rx="2" fill="#fff" stroke="${BRAND.stoneDark}"/>`;
      } else if (q.use === 'balcony') {
        for (let k = 0; k < w; k += 14) s2 += `<line x1="${x + k}" y1="${y}" x2="${x + k}" y2="${y + h}" stroke="${shade(FILL.balcony, 0.9)}" stroke-width="1"/>`;
      }
    }
    // Walls: interior partitions then the heavy outer wall.
    for (const q of plan.rooms) s2 += `<rect x="${ox + q.x * W}" y="${oy + q.y * H}" width="${q.w * W}" height="${q.h * H}" fill="none" stroke="${BRAND.green}" stroke-width="5"/>`;
    s2 += `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="none" stroke="${BRAND.green}" stroke-width="12"/>`;
    // Doors (gap + swing) on each bedroom/bath's lower wall, windows on the outer walls.
    for (const q of plan.rooms) {
      if (!['bed', 'bath', 'kitchen', 'store'].includes(q.use)) continue;
      const dw = Math.min(34, q.w * W * 0.35);
      const dx = ox + q.x * W + q.w * W * 0.62;
      const dy = oy + (q.y + q.h) * H;
      s2 += `<rect x="${dx}" y="${dy - 4}" width="${dw}" height="8" fill="${FILL[q.use]}"/><path d="M${dx},${dy} A${dw},${dw} 0 0 1 ${dx + dw},${dy - dw}" fill="none" stroke="${BRAND.stoneDark}" stroke-width="1.2"/><line x1="${dx + dw}" y1="${dy}" x2="${dx + dw}" y2="${dy - dw}" stroke="${BRAND.green}" stroke-width="2"/>`;
    }
    for (const q of plan.rooms) {
      if (q.y > 0.001) continue;
      const wx = ox + (q.x + q.w * 0.25) * W;
      s2 += `<rect x="${wx}" y="${oy - 6}" width="${q.w * W * 0.5}" height="12" fill="${paper}"/><g stroke="${BRAND.green}" stroke-width="1.5"><line x1="${wx}" y1="${oy - 5}" x2="${wx + q.w * W * 0.5}" y2="${oy - 5}"/><line x1="${wx}" y1="${oy}" x2="${wx + q.w * W * 0.5}" y2="${oy}"/><line x1="${wx}" y1="${oy + 5}" x2="${wx + q.w * W * 0.5}" y2="${oy + 5}"/></g>`;
    }
    // Labels and areas.
    for (const q of plan.rooms) {
      const cx = ox + (q.x + q.w / 2) * W;
      const cy = oy + (q.y + q.h / 2) * H;
      const area = Math.round(((q.w * q.h) / total) * plan.area / 5) * 5;
      const fs = Math.max(11, Math.min(17, q.w * W * 0.09));
      const ly = q.use === 'bed' ? oy + (q.y + q.h) * H - 34 : cy;
      s2 += `<text x="${cx}" y="${ly}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="${BRAND.green}">${q.label.replace(/&/g, "&amp;")}</text>`;
      s2 += `<text x="${cx}" y="${ly + fs + 3}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs - 2}" fill="${BRAND.stoneDark}">${area} sq ft</text>`;
    }
    svg.add(s2);
  });
  // North arrow.
  const nx = s.width - 54;
  svg.add(`<g transform="translate(${nx},${s.height - 70}) rotate(${r.range(-30, 30).toFixed(0)})"><circle r="22" fill="none" stroke="${BRAND.stoneDark}" stroke-width="1.5"/><path d="M0,-18 L7,8 L0,3 L-7,8 Z" fill="${BRAND.brass}"/></g>`);
  return svg.toString();
}
