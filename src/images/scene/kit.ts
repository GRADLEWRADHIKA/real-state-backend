/**
 * Shared drawing kit: sky, haze, distant skyline, ground, shaded boxes with facade detail,
 * cast shadows and trees. Scenes compose these in 3D through the camera.
 */
import { type Camera, type P2, type V3, depth, horizonY, project, projectPoly, pts, scaleAt } from './camera.js';
import { mix, shade } from './color.js';
import type { Palette } from './palette.js';
import type { Rng } from './rng.js';
import { BACK, FRONT, type Svg } from './svg.js';

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export { add3, mul3 };

/** Diffuse light factor for a surface normal. */
export const lightOf = (pal: Palette, n: V3) => pal.ambient + (1 - pal.ambient) * Math.max(0, dot(n, pal.sunDir)) * 1.15;

/** A lit colour: darkened in shade, warmed by the sun where it is hit. */
export function lit(pal: Palette, color: string, n: V3, bias = 0) {
  const k = lightOf(pal, n) + bias;
  const warm = Math.max(0, dot(n, pal.sunDir)) * (pal.time === 'morning' ? 0.06 : 0.16);
  return mix(shade(color, Math.min(1.12, k)), pal.sun, warm);
}

export function poly(cam: Camera, p: V3[], attrs: string) {
  const s = projectPoly(cam, p);
  return s ? `<polygon points="${pts(s)}" ${attrs}/>` : '';
}

export const centroid = (p: V3[]): V3 => mul3(p.reduce(add3, [0, 0, 0] as V3), 1 / p.length);

/** Adds a world-space polygon at its own depth. */
export function quad(svg: Svg, cam: Camera, p: V3[], attrs: string, bias = 0) {
  const m = poly(cam, p, attrs);
  if (m) svg.add(m, depth(cam, centroid(p)) + bias);
}

// ─── Sky and atmosphere ──────────────────────────────────────────────────
export function sky(svg: Svg, cam: Camera, pal: Palette, r: Rng, o: { clouds?: number; sun?: boolean } = {}) {
  const hy = horizonY(cam);
  const top = Math.min(0, hy - cam.h);
  const g = svg.linear([
    [0, pal.skyTop],
    [0.62, pal.skyMid],
    [1, pal.horizon],
  ], 0, top, 0, hy + 2, 'userSpaceOnUse');
  svg.add(`<rect width="${cam.w}" height="${cam.h}" fill="${g}"/>`, BACK);
  if (o.sun !== false) {
    const sx = cam.w * pal.sunX;
    const sy = hy - cam.h * (pal.time === 'dusk' ? 0.04 : pal.time === 'golden' ? 0.16 : 0.42);
    const glow = svg.radial([[0, pal.sun, 0.95], [0.18, pal.sun, 0.5], [1, pal.sun, 0]], sx, sy, cam.w * 0.45, sx, sy, 'userSpaceOnUse');
    svg.add(`<rect width="${cam.w}" height="${cam.h}" fill="${glow}"/>`, BACK);
  }
  const clouds = o.clouds ?? 5;
  const bl = svg.blur(cam.w * 0.012);
  let c = '';
  for (let i = 0; i < clouds; i++) {
    const cx = r.range(-0.1, 1.1) * cam.w;
    const cy = r.range(0.06, 0.8) * Math.max(40, hy);
    const cw = r.range(0.12, 0.32) * cam.w;
    const ch = cw * r.range(0.08, 0.16);
    const op = r.range(0.25, 0.55);
    for (let k = 0; k < 4; k++) {
      c += `<ellipse cx="${(cx + (k - 1.5) * cw * 0.28).toFixed(0)}" cy="${(cy + r.range(-0.4, 0.3) * ch).toFixed(0)}" rx="${(cw * r.range(0.25, 0.42)).toFixed(0)}" ry="${(ch * r.range(0.6, 1.1)).toFixed(0)}" fill="${pal.cloud}" opacity="${op.toFixed(2)}"/>`;
    }
  }
  if (c) svg.add(`<g filter="${bl}">${c}</g>`, BACK);
}

/** Hazy distant city silhouette sitting on the horizon. */
export function skyline(svg: Svg, cam: Camera, pal: Palette, r: Rng, o: { height?: number; rows?: number; lights?: boolean } = {}) {
  const hy = horizonY(cam);
  const H = (o.height ?? 0.09) * cam.h;
  for (let row = 0; row < (o.rows ?? 2); row++) {
    const col = mix(pal.haze, pal.skyMid, row === 0 ? 0.5 : 0.15);
    let x = -r.range(0, 40);
    let s = '';
    while (x < cam.w) {
      const bw = r.range(0.015, 0.05) * cam.w;
      const bh = H * (row === 0 ? r.range(0.3, 1.1) : r.range(0.15, 0.6)) * (r.chance(0.08) ? 1.7 : 1);
      if (r.chance(0.82)) {
        s += `<rect x="${x.toFixed(0)}" y="${(hy - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${(bh + 2).toFixed(0)}"/>`;
        if (o.lights && row === 1) {
          for (let k = 0; k < 4; k++) if (r.chance(0.5)) s += `<rect x="${(x + r.range(0.1, 0.8) * bw).toFixed(0)}" y="${(hy - r.range(0.1, 0.9) * bh).toFixed(0)}" width="2" height="2" fill="${pal.lit}" opacity="0.7"/>`;
        }
      }
      x += bw + r.range(0, 0.012) * cam.w;
    }
    svg.add(`<g fill="${col}" opacity="${row === 0 ? 0.55 : 0.75}">${s}</g>`, BACK);
  }
}

/** Band of tree tops along the horizon (distant woodland / avenue planting). */
export function treeLine(svg: Svg, cam: Camera, pal: Palette, r: Rng, o: { height?: number; color?: string } = {}) {
  const hy = horizonY(cam);
  const H = (o.height ?? 0.035) * cam.h;
  const col = o.color ?? mix(pal.foliage[0], pal.haze, 0.55);
  let s = '';
  for (let x = -20; x < cam.w + 20; x += r.range(8, 22) * (cam.w / 1600)) {
    const rr = H * r.range(0.4, 1);
    s += `<circle cx="${x.toFixed(0)}" cy="${(hy - rr * 0.5).toFixed(0)}" r="${rr.toFixed(1)}"/>`;
  }
  s += `<rect x="0" y="${(hy - 2).toFixed(0)}" width="${cam.w}" height="${(H * 0.5).toFixed(0)}"/>`;
  svg.add(`<g fill="${col}">${s}</g>`, BACK - 1);
}

/** Large ground plane with depth-graded colour. */
export function ground(svg: Svg, cam: Camera, pal: Palette, color = pal.grass, far = pal.grassFar, extent = 2000) {
  const hy = horizonY(cam);
  const g = svg.linear([[0, far], [0.25, mix(color, far, 0.4)], [1, shade(color, 0.85)]], 0, hy, 0, cam.h, 'userSpaceOnUse');
  const p = poly(cam, [[-extent, 0, -5], [extent, 0, -5], [extent, 0, extent], [-extent, 0, extent]].map(([x, y, z]) => [cam.pos[0] + x, y, cam.pos[2] + z] as V3), `fill="${g}"`);
  svg.add(p, BACK - 2);
}

/** Atmospheric haze that softens everything near the horizon. */
export function haze(svg: Svg, cam: Camera, pal: Palette, strength = 0.55) {
  const hy = horizonY(cam);
  const band = cam.h * 0.22;
  const g = svg.linear([[0, pal.haze, 0], [0.8, pal.haze, strength], [1, pal.haze, 0]], 0, hy - band, 0, hy + band * 0.25, 'userSpaceOnUse');
  svg.add(`<rect y="${(hy - band).toFixed(0)}" width="${cam.w}" height="${(band * 1.25).toFixed(0)}" fill="${g}"/>`, BACK - 3);
}

// ─── Boxes ───────────────────────────────────────────────────────────────
export interface Face {
  /** Bottom-left corner seen from outside. */
  o: V3;
  u: V3;
  v: V3;
  w: number;
  h: number;
  n: V3;
  name: 'x-' | 'x+' | 'z-' | 'z+' | 'top';
}

export const at = (f: Face, s: number, t: number, out = 0): V3 => add3(add3(add3(f.o, mul3(f.u, s)), mul3(f.v, t)), mul3(f.n, out));

/** A rectangle on a face (s, t in metres from the face's bottom-left). */
export function faceRect(cam: Camera, f: Face, s0: number, t0: number, s1: number, t1: number, attrs: string, out = 0.03) {
  return poly(cam, [at(f, s0, t0, out), at(f, s1, t0, out), at(f, s1, t1, out), at(f, s0, t1, out)], attrs);
}

export interface BoxOpts {
  color: string;
  top?: string;
  stroke?: string;
  /** Called for each visible face; returns extra markup drawn on top of that face. */
  decorate?: (f: Face, fill: string) => string;
  bias?: number;
  opacity?: number;
}

export function boxFaces(min: V3, max: V3): Face[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return [
    { name: 'z-', o: [x0, y0, z0], u: [1, 0, 0], v: [0, 1, 0], w: x1 - x0, h: y1 - y0, n: [0, 0, -1] },
    { name: 'z+', o: [x1, y0, z1], u: [-1, 0, 0], v: [0, 1, 0], w: x1 - x0, h: y1 - y0, n: [0, 0, 1] },
    { name: 'x-', o: [x0, y0, z1], u: [0, 0, -1], v: [0, 1, 0], w: z1 - z0, h: y1 - y0, n: [-1, 0, 0] },
    { name: 'x+', o: [x1, y0, z0], u: [0, 0, 1], v: [0, 1, 0], w: z1 - z0, h: y1 - y0, n: [1, 0, 0] },
    { name: 'top', o: [x0, y1, z0], u: [1, 0, 0], v: [0, 0, 1], w: x1 - x0, h: z1 - z0, n: [0, 1, 0] },
  ];
}

function faceVisible(cam: Camera, f: Face) {
  const toCam: V3 = [cam.pos[0] - f.o[0], cam.pos[1] - f.o[1], cam.pos[2] - f.o[2]];
  return dot(toCam, f.n) > 0;
}

/** Markup for a shaded axis-aligned box (visible faces only, decorated). */
export function boxMarkup(cam: Camera, pal: Palette, min: V3, max: V3, o: BoxOpts) {
  let s = '';
  for (const f of boxFaces(min, max)) {
    if (!faceVisible(cam, f)) continue;
    const fill = lit(pal, f.name === 'top' ? (o.top ?? o.color) : o.color, f.n);
    const p = poly(cam, [at(f, 0, 0), at(f, f.w, 0), at(f, f.w, f.h), at(f, 0, f.h)], `fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="0.6"` : ''}`);
    if (!p) continue;
    s += p;
    if (o.decorate) s += o.decorate(f, fill);
  }
  return o.opacity !== undefined ? `<g opacity="${o.opacity}">${s}</g>` : s;
}

export function box(svg: Svg, cam: Camera, pal: Palette, min: V3, max: V3, o: BoxOpts & { ao?: boolean }) {
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  if (o.ao !== false && min[1] <= 0.01 && max[0] - min[0] < 8) {
    // Contact shadow so objects sit on the floor instead of floating.
    const e = 0.08;
    const g: V3[] = [[min[0] - e, 0.003, min[2] - e], [max[0] + e, 0.003, min[2] - e], [max[0] + e, 0.003, max[2] + e], [min[0] - e, 0.003, max[2] + e]];
    const m = poly(cam, g, `fill="#000" opacity="0.22" filter="${svg.blur(Math.max(1, scaleAt(cam, c) * 0.06))}"`);
    if (m) svg.add(m, 1e6 - 0.8);
  }
  svg.add(boxMarkup(cam, pal, min, max, o), depth(cam, c) + (o.bias ?? 0));
}

function hull(points: [number, number][]) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Soft shadow a box casts on the ground plane (y = gy) away from the sun. */
export function castShadow(svg: Svg, cam: Camera, pal: Palette, min: V3, max: V3, gy = 0, strength = 1) {
  const L = pal.sunDir;
  const k = 1 / Math.max(0.12, L[1]);
  const foot: [number, number][] = [];
  for (const x of [min[0], max[0]])
    for (const z of [min[2], max[2]]) {
      foot.push([x, z]);
      const hgt = max[1] - gy;
      foot.push([x - L[0] * hgt * k, z - L[2] * hgt * k]);
    }
  const h = hull(foot).map(([x, z]) => [x, gy + 0.02, z] as V3);
  const bl = svg.blur(Math.max(1, scaleAt(cam, centroid(h)) * 0.25));
  const m = poly(cam, h, `fill="${pal.shadow}" opacity="${(pal.shadowOpacity * strength).toFixed(2)}" filter="${bl}"`);
  if (m) svg.add(m, depth(cam, centroid(h)) + 5000);
}

// ─── Planting ────────────────────────────────────────────────────────────
export type TreeKind = 'round' | 'tall' | 'palm' | 'shrub';

export function treeMarkup(cam: Camera, pal: Palette, r: Rng, pos: V3, height: number, kind: TreeKind = 'round', shadow = true) {
  const base = project(cam, pos);
  if (!base) return '';
  const k = scaleAt(cam, pos);
  if (k * height < 2) return '';
  const [bx, by] = base;
  const leaf = r.pick(pal.foliage);
  const hi = mix(leaf, pal.sun, pal.time === 'dusk' ? 0.12 : 0.35);
  const lo = shade(leaf, 0.55);
  const sx = pal.sunDir[0] >= 0 ? 0.35 : -0.35;
  let s = '';
  if (shadow) {
    const L = pal.sunDir;
    const len = Math.min(3, (height * 0.6) / Math.max(0.2, L[1]));
    const sp = project(cam, [pos[0] - L[0] * len * 0.5, 0.02, pos[2] - L[2] * len * 0.5]);
    if (sp) s += `<ellipse cx="${sp[0].toFixed(1)}" cy="${sp[1].toFixed(1)}" rx="${(k * height * 0.38).toFixed(1)}" ry="${(k * height * 0.1).toFixed(1)}" fill="${pal.shadow}" opacity="${(pal.shadowOpacity * 0.9).toFixed(2)}"/>`;
  }
  const trunkH = k * height * (kind === 'palm' ? 0.85 : kind === 'shrub' ? 0.05 : 0.38);
  const tw = Math.max(1, k * height * (kind === 'palm' ? 0.03 : 0.045));
  if (kind !== 'shrub') s += `<path d="M${(bx - tw).toFixed(1)},${by.toFixed(1)} L${(bx - tw * 0.5).toFixed(1)},${(by - trunkH).toFixed(1)} L${(bx + tw * 0.5).toFixed(1)},${(by - trunkH).toFixed(1)} L${(bx + tw).toFixed(1)},${by.toFixed(1)}Z" fill="${shade('#5a4636', 0.8)}"/>`;
  if (kind === 'palm') {
    const tx = bx;
    const ty = by - trunkH;
    const L = k * height * 0.32;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r.range(-0.2, 0.2);
      const ex = tx + Math.cos(a) * L;
      const ey = ty + Math.sin(a) * L * 0.45 + L * 0.25;
      s += `<path d="M${tx.toFixed(1)},${ty.toFixed(1)} Q${((tx + ex) / 2).toFixed(1)},${(ty - L * 0.35).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" stroke="${i % 2 ? leaf : hi}" stroke-width="${Math.max(1, L * 0.12).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  }
  const cw = k * height * (kind === 'tall' ? 0.2 : kind === 'shrub' ? 0.6 : 0.4);
  const ch = k * height * (kind === 'tall' ? 0.72 : kind === 'shrub' ? 0.5 : 0.55);
  const cy = by - trunkH - ch * 0.45;
  // Canopy built from many small leaf clumps: darker underneath, sunlit on top and towards the sun.
  s += `<ellipse cx="${bx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(cw * 0.95).toFixed(1)}" ry="${(ch * 0.5).toFixed(1)}" fill="${lo}"/>`;
  const clumps = Math.max(6, Math.min(26, Math.round(cw / 2.5)));
  const cl: [number, number, number][] = [];
  for (let i = 0; i < clumps; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = Math.sqrt(r.next()) * 0.85;
    cl.push([Math.cos(a) * d, Math.sin(a) * d, r.range(0.22, 0.38)]);
  }
  cl.sort((a, b) => a[1] - b[1] * -1);
  for (const [dx, dy, rr] of cl.sort((a, b) => b[1] - a[1])) {
    const light = Math.max(0, Math.min(1, 0.5 - dy * 0.6 + dx * sx));
    const c = mix(mix(lo, leaf, Math.min(1, light * 1.6)), hi, Math.max(0, light - 0.55) * 1.6);
    s += `<ellipse cx="${(bx + dx * cw).toFixed(1)}" cy="${(cy + dy * ch * 0.5).toFixed(1)}" rx="${(rr * cw).toFixed(1)}" ry="${(rr * cw * 0.85).toFixed(1)}" fill="${c}"/>`;
  }
  return s;
}

/** Registers the canopy gradients trees reference (call once per scene). */
export function treeDefs(svg: Svg, pal: Palette) {
  for (const leaf of new Set(pal.foliage)) {
    const hi = mix(leaf, pal.sun, pal.time === 'dusk' ? 0.12 : 0.35);
    for (const side of ['l', 'r']) {
      svg.def(
        `<radialGradient id="tg_${leaf.slice(1)}_${hi.slice(1)}_${side}" cx="${side === 'r' ? 0.65 : 0.35}" cy="0.3" r="0.8"><stop offset="0" stop-color="${hi}"/><stop offset="0.55" stop-color="${leaf}"/><stop offset="1" stop-color="${shade(leaf, 0.6)}"/></radialGradient>`,
      );
    }
  }
}

export function tree(svg: Svg, cam: Camera, pal: Palette, r: Rng, pos: V3, height: number, kind: TreeKind = 'round') {
  const m = treeMarkup(cam, pal, r, pos, height, kind);
  if (m) svg.add(m, depth(cam, pos) - 0.5);
}

/** Close-up foreground planting framing the bottom of the image. */
export function foregroundFoliage(svg: Svg, pal: Palette, r: Rng, side: 'left' | 'right' | 'both' = 'both', size = 1) {
  const w = svg.w;
  const h = svg.h;
  const bl = svg.blur(w * 0.0025);
  let s = '';
  const sides = side === 'both' ? ['left', 'right'] : [side];
  for (const sd of sides) {
    const base = shade(r.pick(pal.foliage), 0.5);
    for (let i = 0; i < 90; i++) {
      const t = Math.pow(r.next(), 1.6);
      const x = sd === 'left' ? (-0.02 + t * 0.2) * w : (1.02 - t * 0.2) * w;
      const y = h - r.range(0, 0.2 * (1 - t) + 0.02) * h * size;
      const rr = r.range(0.008, 0.022) * w * size;
      const c = mix(base, pal.sun, r.range(0, 0.25) * (1 - t * 0.5));
      s += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rr.toFixed(0)}" ry="${(rr * 0.6).toFixed(0)}" transform="rotate(${r.range(-40, 40).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${c}"/>`;
    }
  }
  svg.add(`<g filter="${bl}">${s}</g>`, FRONT + 10);
}

// ─── Finishing ───────────────────────────────────────────────────────────
export function finish(svg: Svg, pal: Palette, vignette = 0.38) {
  svg.add(`<rect width="${svg.w}" height="${svg.h}" fill="${pal.grade}" opacity="${pal.gradeOpacity}"/>`, FRONT + 2);
  const v = svg.radial([[0, '#000', 0], [0.62, '#000', 0], [1, '#0a120e', vignette]], 0.5, 0.48, 0.75);
  svg.add(`<rect width="${svg.w}" height="${svg.h}" fill="${v}"/>`, FRONT + 1);
}

export type { Camera, P2, V3 };
