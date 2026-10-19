/**
 * Interior kit: a room shell seen from inside (one- or two-point perspective), a window with the
 * view outside, sunlight falling on the floor, and furniture built from shaded boxes.
 */
import { type Camera, type V3, depth, projectPoly, pts } from './camera.js';
import { mix, shade } from './color.js';
import { box, lit, quad, treeMarkup } from './kit.js';
import type { Palette } from './palette.js';
import type { Rng } from './rng.js';
import { BACK, type Svg } from './svg.js';

export interface Room {
  w: number;
  d: number;
  h: number;
}

export interface WindowSpec {
  /** Horizontal extent along the back wall (x). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  mullions?: number;
  /** Ground-level view (garden) instead of a city view from a height. */
  low?: boolean;
}

/** Room box spanning x ±w/2, z 0..d, y 0..h. Walls face inwards. */
export function roomShell(svg: Svg, cam: Camera, pal: Palette, r: Rng, room: Room, o: { wall: string; floor: string; ceiling?: string; planks?: boolean; tiles?: boolean; feature?: string; windows: WindowSpec[] }) {
  const { w, d, h } = room;
  const L = -w / 2;
  const R = w / 2;
  const far = 1e6;
  const wallLit = (n: V3, c: string) => lit(pal, c, n, 0.08);
  // Back wall with window cut-outs drawn over it.
  const back: V3[] = [[L, 0, d], [R, 0, d], [R, h, d], [L, h, d]];
  const left: V3[] = [[L, 0, -2], [L, 0, d], [L, h, d], [L, h, -2]];
  const right: V3[] = [[R, 0, d], [R, 0, -2], [R, h, -2], [R, h, d]];
  const floor: V3[] = [[L, 0, -2], [R, 0, -2], [R, 0, d], [L, 0, d]];
  const ceil: V3[] = [[L, h, d], [R, h, d], [R, h, -2], [L, h, -2]];
  const wallG = (base: string, n: V3) => svg.linear([[0, shade(wallLit(n, base), 1.04)], [1, shade(wallLit(n, base), 0.9)]]);
  const add = (p: V3[], fill: string, dd: number) => {
    const s = projectPoly(cam, p);
    if (s) svg.add(`<polygon points="${pts(s)}" fill="${fill}"/>`, far + dd);
  };
  add(ceil, svg.linear([[0, shade(o.ceiling ?? '#f4efe6', 0.86)], [1, shade(o.ceiling ?? '#f4efe6', 0.98)]]), 4);
  add(left, wallG(o.wall, [1, 0, 0]), 3);
  add(right, wallG(o.feature ?? o.wall, [-1, 0, 0]), 3);
  add(back, wallG(o.wall, [0, 0, -1]), 2);
  const fg = svg.linear([[0, shade(o.floor, 0.95)], [1, shade(o.floor, 0.78)]]);
  add(floor, fg, 1);
  // Floor pattern.
  let pat = '';
  if (o.planks) {
    for (let x = L; x < R; x += 0.22) {
      const s = projectPoly(cam, [[x, 0.001, -1], [x + 0.005, 0.001, -1], [x + 0.005, 0.001, d], [x, 0.001, d]]);
      if (s) pat += `<polygon points="${pts(s)}"/>`;
    }
    if (pat) svg.add(`<g fill="${shade(o.floor, 0.7)}" opacity="0.35">${pat}</g>`, far);
  } else if (o.tiles) {
    for (let x = L; x <= R; x += 0.8) {
      const s = projectPoly(cam, [[x, 0.001, -1], [x + 0.01, 0.001, -1], [x + 0.01, 0.001, d], [x, 0.001, d]]);
      if (s) pat += `<polygon points="${pts(s)}"/>`;
    }
    for (let z = 0; z <= d; z += 0.8) {
      const s = projectPoly(cam, [[L, 0.001, z], [R, 0.001, z], [R, 0.001, z + 0.01], [L, 0.001, z + 0.01]]);
      if (s) pat += `<polygon points="${pts(s)}"/>`;
    }
    if (pat) svg.add(`<g fill="${shade(o.floor, 0.75)}" opacity="0.4">${pat}</g>`, far);
  }
  // Skirting.
  quad(svg, cam, [[L, 0, d - 0.01], [R, 0, d - 0.01], [R, 0.1, d - 0.01], [L, 0.1, d - 0.01]], `fill="${shade(o.wall, 0.8)}"`, far);
  for (const win of o.windows) windowView(svg, cam, pal, r.fork(`win${win.x0}`), d, win, far);
  // Soft daylight gradient across the room.
  const s = svg.radial([[0, pal.sun, 0.18], [1, pal.sun, 0]], 0.5, 0.35, 0.7);
  svg.add(`<rect width="${svg.w}" height="${svg.h}" fill="${s}"/>`, -1e8);
}

function windowView(svg: Svg, cam: Camera, pal: Palette, r: Rng, d: number, win: WindowSpec, far: number) {
  const p = projectPoly(cam, [[win.x0, win.y0, d], [win.x1, win.y0, d], [win.x1, win.y1, d], [win.x0, win.y1, d]]);
  if (!p) return;
  const clip = svg.clip(`<polygon points="${pts(p)}"/>`);
  const ys = p.map((q) => q[1]);
  const xs = p.map((q) => q[0]);
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  const hy = win.low ? top + (bot - top) * 0.62 : top + (bot - top) * 0.72;
  const skyG = svg.linear([[0, pal.skyTop], [0.7, pal.skyMid], [1, pal.horizon]], 0, top, 0, hy, 'userSpaceOnUse');
  let s = `<rect x="${Math.min(...xs) - 5}" y="${top - 5}" width="${Math.max(...xs) - Math.min(...xs) + 10}" height="${bot - top + 10}" fill="${skyG}"/>`;
  const x0 = Math.min(...xs);
  const ww = Math.max(...xs) - x0;
  if (!win.low) {
    // City view from a height: hazy skyline and tree canopy below.
    let x = x0;
    while (x < x0 + ww) {
      const bw = r.range(0.03, 0.08) * ww;
      const bh = r.range(0.04, 0.2) * (bot - top);
      s += `<rect x="${x.toFixed(0)}" y="${(hy - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${(bh + 1).toFixed(0)}" fill="${mix(pal.haze, pal.skyMid, 0.3)}" opacity="0.8"/>`;
      x += bw + r.range(0, 0.02) * ww;
    }
    s += `<rect x="${x0}" y="${hy}" width="${ww}" height="${bot - hy + 5}" fill="${mix(pal.foliage[0], pal.haze, 0.45)}"/>`;
    for (let i = 0; i < 40; i++) s += `<circle cx="${(x0 + r.next() * ww).toFixed(0)}" cy="${(hy + r.range(0, 0.4) * (bot - hy)).toFixed(0)}" r="${r.range(0.01, 0.03) * ww}" fill="${mix(r.pick(pal.foliage), pal.haze, 0.3)}"/>`;
  } else {
    s += `<rect x="${x0}" y="${hy}" width="${ww}" height="${bot - hy + 5}" fill="${pal.grass}"/>`;
    for (let i = 0; i < 9; i++) {
      const cx = x0 + r.next() * ww;
      const rr = r.range(0.05, 0.12) * ww;
      s += `<ellipse cx="${cx.toFixed(0)}" cy="${(hy - rr * 0.3).toFixed(0)}" rx="${rr.toFixed(0)}" ry="${(rr * 0.8).toFixed(0)}" fill="${mix(r.pick(pal.foliage), pal.sun, 0.15)}"/>`;
    }
  }
  s += `<rect x="${x0 - 5}" y="${top - 5}" width="${ww + 10}" height="${bot - top + 10}" fill="#ffffff" opacity="0.12"/>`;
  svg.add(`<g clip-path="${clip}">${s}</g>`, far + 1.5);
  // Frame and mullions.
  const m = win.mullions ?? 2;
  const fc = '#2b2f2c';
  for (let i = 0; i <= m; i++) {
    const x = win.x0 + ((win.x1 - win.x0) * i) / m;
    quad(svg, cam, [[x - 0.03, win.y0, d - 0.02], [x + 0.03, win.y0, d - 0.02], [x + 0.03, win.y1, d - 0.02], [x - 0.03, win.y1, d - 0.02]], `fill="${fc}"`, far);
  }
  for (const y of [win.y0, win.y1]) quad(svg, cam, [[win.x0, y - 0.03, d - 0.02], [win.x1, y - 0.03, d - 0.02], [win.x1, y + 0.03, d - 0.02], [win.x0, y + 0.03, d - 0.02]], `fill="${fc}"`, far);
  // Sunlight patch on the floor, cast from the window towards the camera.
  const L = pal.sunDir;
  const k = (y: number) => y / Math.max(0.3, L[1]);
  const sp = (x: number, y: number): V3 => [x + L[0] * k(y) * 0.4, 0.004, d - Math.abs(L[2]) * k(y) * 0.9];
  const patch = projectPoly(cam, [sp(win.x0, win.y0), sp(win.x1, win.y0), sp(win.x1, win.y1), sp(win.x0, win.y1)]);
  if (patch) svg.add(`<polygon points="${pts(patch)}" fill="${pal.sun}" opacity="${pal.time === 'morning' ? 0.18 : 0.26}" filter="${svg.blur(3)}"/>`, far + 0.5);
}

// ─── Furniture ───────────────────────────────────────────────────────────
type Ctx = { svg: Svg; cam: Camera; pal: Palette };

export function sofa({ svg, cam, pal }: Ctx, x: number, z: number, w: number, color: string, facing: 'back' | 'left' | 'right' = 'back') {
  const d = 0.95;
  if (facing === 'back') {
    box(svg, cam, pal, [x, 0, z], [x + w, 0.42, z + d], { color });
    box(svg, cam, pal, [x, 0.42, z + d - 0.22], [x + w, 0.85, z + d], { color: shade(color, 0.95) });
    box(svg, cam, pal, [x - 0.18, 0, z], [x, 0.62, z + d], { color: shade(color, 0.92) });
    box(svg, cam, pal, [x + w, 0, z], [x + w + 0.18, 0.62, z + d], { color: shade(color, 0.92) });
    for (let i = 0; i < 3; i++) box(svg, cam, pal, [x + 0.15 + i * (w / 3), 0.42, z + d - 0.36], [x + (i + 1) * (w / 3) - 0.1, 0.72, z + d - 0.22], { color: i === 1 ? pal.accent : shade(color, 1.12) });
  } else {
    const sx = facing === 'left' ? x + d : x - d;
    const [a, b] = facing === 'left' ? [x, sx] : [sx, x];
    box(svg, cam, pal, [a, 0, z], [b, 0.42, z + w], { color });
    const backX = facing === 'left' ? a : b - 0.22;
    box(svg, cam, pal, [backX, 0.42, z], [backX + 0.22, 0.85, z + w], { color: shade(color, 0.95) });
    box(svg, cam, pal, [a, 0, z - 0.18], [b, 0.62, z], { color: shade(color, 0.92) });
    box(svg, cam, pal, [a, 0, z + w], [b, 0.62, z + w + 0.18], { color: shade(color, 0.92) });
  }
}

export function rug({ svg, cam }: Ctx, x0: number, z0: number, x1: number, z1: number, color: string, border?: string) {
  quad(svg, cam, [[x0, 0.006, z0], [x1, 0.006, z0], [x1, 0.006, z1], [x0, 0.006, z1]], `fill="${color}"`, 1e6 - 1);
  if (border) {
    const b = 0.12;
    quad(svg, cam, [[x0 + b, 0.008, z0 + b], [x1 - b, 0.008, z0 + b], [x1 - b, 0.008, z1 - b], [x0 + b, 0.008, z1 - b]], `fill="none" stroke="${border}" stroke-width="2" opacity="0.7"`, 1e6 - 1.5);
  }
}

export function table({ svg, cam, pal }: Ctx, x0: number, z0: number, x1: number, z1: number, hgt: number, top: string, leg = '#3b3027') {
  box(svg, cam, pal, [x0, hgt - 0.05, z0], [x1, hgt, z1], { color: top });
  for (const [x, z] of [[x0 + 0.05, z0 + 0.05], [x1 - 0.1, z0 + 0.05], [x0 + 0.05, z1 - 0.1], [x1 - 0.1, z1 - 0.1]]) box(svg, cam, pal, [x, 0, z], [x + 0.05, hgt - 0.05, z + 0.05], { color: leg });
}

export function plant({ svg, cam, pal }: Ctx, r: Rng, x: number, z: number, hgt = 1.3) {
  box(svg, cam, pal, [x - 0.18, 0, z - 0.18], [x + 0.18, 0.4, z + 0.18], { color: '#b9a690' });
  const m = treeMarkup(cam, pal, r, [x, 0.38, z], hgt, 'shrub', false);
  if (m) svg.add(m, depth(cam, [x, 0.5, z]) - 0.3);
}

/** Abstract artwork (no text) hung on a wall plane at x = wx or z = wz. */
export function artwork({ svg, cam, pal }: Ctx, r: Rng, at: { z: number; x0: number; x1: number } | { x: number; z0: number; z1: number }, y0: number, y1: number) {
  const corners: V3[] = 'z' in at ? [[at.x0, y0, at.z], [at.x1, y0, at.z], [at.x1, y1, at.z], [at.x0, y1, at.z]] : [[at.x, y0, at.z0], [at.x, y0, at.z1], [at.x, y1, at.z1], [at.x, y1, at.z0]];
  const p = projectPoly(cam, corners);
  if (!p) return;
  const clip = svg.clip(`<polygon points="${pts(p)}"/>`);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const [x, y, w, h] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${mix('#efe6d6', pal.sun, 0.1)}"/>`;
  for (let i = 0; i < 3; i++) s += `<circle cx="${(x + r.range(0.2, 0.8) * w).toFixed(0)}" cy="${(y + r.range(0.3, 0.8) * h).toFixed(0)}" r="${(r.range(0.15, 0.35) * Math.min(w, h)).toFixed(0)}" fill="${r.pick([pal.accent, '#062419', '#c9b48f', '#7d9a7e'])}" opacity="0.85"/>`;
  s += `<rect x="${x}" y="${(y + h * r.range(0.55, 0.75)).toFixed(0)}" width="${w}" height="${(h * 0.06).toFixed(0)}" fill="#062419" opacity="0.5"/>`;
  svg.add(`<g clip-path="${clip}">${s}</g><polygon points="${pts(p)}" fill="none" stroke="#2b2420" stroke-width="3"/>`, 1e6 - 0.5);
}

export function pendant({ svg, cam, pal }: Ctx, x: number, z: number, top: number, drop: number, rr = 0.22) {
  const a = projectPoly(cam, [[x - 0.005, top, z], [x + 0.005, top, z], [x + 0.005, top - drop, z], [x - 0.005, top - drop, z]]);
  const c = projectPoly(cam, [[x - rr, top - drop - rr * 0.6, z], [x + rr, top - drop - rr * 0.6, z], [x + rr, top - drop, z], [x - rr, top - drop, z]]);
  if (!a || !c) return;
  const g = svg.radial([[0, '#fff3d6', 0.6], [1, pal.lit, 0]]);
  const cx = (c[0][0] + c[1][0]) / 2;
  const cy = c[2][1];
  const w = Math.abs(c[1][0] - c[0][0]);
  svg.add(`<polygon points="${pts(a)}" fill="#222"/><circle cx="${cx}" cy="${cy + w * 0.4}" r="${w * 1.6}" fill="${g}"/><path d="M${cx - w / 2},${cy + w * 0.35} Q${cx},${cy - w * 0.45} ${cx + w / 2},${cy + w * 0.35} Z" fill="${pal.accent}"/>`, depth(cam, [x, top - drop, z]) - 0.2);
}

export { BACK };
