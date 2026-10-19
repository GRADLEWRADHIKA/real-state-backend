/** A contemporary G+1 villa massing shared by the front, backyard and aerial views. */
import { type Camera, type V3 } from './camera.js';
import { mix, shade } from './color.js';
import { facade, glassFills } from './facade.js';
import { box, castShadow, quad } from './kit.js';
import { BRAND, type Palette } from './palette.js';
import type { Rng } from './rng.js';
import type { Svg } from './svg.js';

export interface VillaOpts {
  /** Front-left corner on the ground; the villa extends +x (width) and +z (depth). */
  at: V3;
  w: number;
  d: number;
  accent: string;
  litRatio: number;
  shadow?: boolean;
}

export function villa(svg: Svg, cam: Camera, pal: Palette, r: Rng, o: VillaOpts) {
  const [x, , z] = o.at;
  const fills = glassFills(svg, pal);
  const wall = r.pick([BRAND.stoneLight, '#f1ece3', '#e9dfcf']);
  const clad = r.pick([BRAND.stoneDark, '#8b7a66', '#6f6255']);
  const g: [V3, V3] = [[x, 0, z], [x + o.w, 3.4, z + o.d]];
  const up: [V3, V3] = [[x + o.w * 0.28, 3.4, z - 1.2], [x + o.w, 6.6, z + o.d * 0.8]];
  const deco = (bays: number, glazing: number, lit: number) => (f: Parameters<typeof facade>[3]) =>
    f.name === 'top' ? '' : facade(cam, pal, r, f, fills, { floorH: 3.3, bays: f.name[0] === 'z' ? bays : Math.max(1, Math.round(f.w / 5)), glazing: f.name[0] === 'z' ? glazing : glazing * 0.6, litRatio: lit, slab: wall, curtain: true });
  if (o.shadow !== false) {
    castShadow(svg, cam, pal, g[0], g[1]);
    castShadow(svg, cam, pal, up[0], up[1]);
  }
  box(svg, cam, pal, g[0], g[1], { color: wall, decorate: deco(4, 0.7, o.litRatio) });
  // Stone-clad entrance block and upper volume with a cantilever.
  box(svg, cam, pal, [x - 0.2, 0, z - 0.25], [x + o.w * 0.26, 3.5, z + 2.5], { color: clad });
  box(svg, cam, pal, [x + o.w * 0.26, 3.35, z - 1.3], [x + o.w + 0.2, 3.6, z + o.d * 0.82], { color: wall });
  box(svg, cam, pal, up[0], up[1], { color: wall, decorate: deco(3, 0.62, o.litRatio) });
  box(svg, cam, pal, [up[0][0] - 0.2, 6.6, up[0][2] - 0.2], [up[1][0] + 0.2, 6.95, up[1][2] + 0.2], { color: shade(wall, 0.92) });
  // Brass fins on the upper floor and a pergola on the open terrace.
  for (let i = 0; i < 7; i++) {
    const fx = up[0][0] + 0.4 + i * ((up[1][0] - up[0][0] - 0.8) / 6);
    box(svg, cam, pal, [fx, 3.6, up[0][2] - 0.25], [fx + 0.12, 6.6, up[0][2] - 0.05], { color: o.accent });
  }
  for (let i = 0; i < 6; i++) box(svg, cam, pal, [x + 0.2 + i * 0.3, 3.9, z + 2.6], [x + 0.3 + i * 0.3, 4.0, z + o.d * 0.8], { color: '#5a4636' });
  // Planter ledge along the front.
  box(svg, cam, pal, [x + o.w * 0.3, 0, z - 0.9], [x + o.w, 0.5, z - 0.3], { color: shade(clad, 1.1) });
  quad(svg, cam, [[x + o.w * 0.3, 0.51, z - 0.85], [x + o.w, 0.51, z - 0.85], [x + o.w, 0.51, z - 0.35], [x + o.w * 0.3, 0.51, z - 0.35]], `fill="${mix(pal.foliage[2], pal.sun, 0.2)}"`);
  return { wall, clad };
}

/** Rectangular pool cut into the ground with a stone coping and ripples. */
export function pool(svg: Svg, cam: Camera, pal: Palette, r: Rng, x0: number, z0: number, x1: number, z1: number) {
  const water = svg.linear([[0, '#9fd3d6'], [0.5, '#4fa3b0'], [1, '#2f7f91']]);
  box(svg, cam, pal, [x0 - 0.4, 0, z0 - 0.4], [x1 + 0.4, 0.06, z1 + 0.4], { color: BRAND.stoneLight, ao: false });
  quad(svg, cam, [[x0, 0.07, z0], [x1, 0.07, z0], [x1, 0.07, z1], [x0, 0.07, z1]], `fill="${water}"`, -0.5);
  for (let i = 0; i < 14; i++) {
    const x = r.range(x0 + 0.3, x1 - 1);
    const z = r.range(z0 + 0.3, z1 - 0.3);
    quad(svg, cam, [[x, 0.08, z], [x + r.range(0.4, 1.4), 0.08, z], [x + r.range(0.4, 1.4), 0.08, z + 0.05], [x, 0.08, z + 0.05]], `fill="#ffffff" opacity="0.35"`, -1);
  }
}

export function lounger(svg: Svg, cam: Camera, pal: Palette, x: number, z: number, color: string) {
  box(svg, cam, pal, [x, 0, z], [x + 0.7, 0.32, z + 1.9], { color: '#e9e2d6' });
  box(svg, cam, pal, [x, 0.32, z + 1.4], [x + 0.7, 0.75, z + 1.9], { color });
}

export function umbrella(svg: Svg, cam: Camera, pal: Palette, x: number, z: number, color: string) {
  box(svg, cam, pal, [x - 0.03, 0, z - 0.03], [x + 0.03, 2.3, z + 0.03], { color: '#4a3b2f' });
  const top: V3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    top.push([x + Math.cos(a) * 1.3, 2.2, z + Math.sin(a) * 1.3]);
  }
  quad(svg, cam, top, `fill="${shade(color, 0.85)}"`, -0.1);
  quad(svg, cam, top.map(([a, , c]) => [x + (a - x) * 0.5, 2.45, z + (c - z) * 0.5] as V3), `fill="${color}"`, -0.2);
}
