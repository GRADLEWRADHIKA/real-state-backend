import type { Camera } from './camera.js';
import { mix, shade } from './color.js';
import { type Face, faceRect, lightOf, lit } from './kit.js';
import { BRAND } from './palette.js';
import type { Palette } from './palette.js';
import type { Rng } from './rng.js';
import type { Svg } from './svg.js';

export interface FacadeOpts {
  floorH: number;
  bays: number;
  /** Fraction of a bay that is glass. */
  glazing: number;
  litRatio: number;
  slab: string;
  fin?: string;
  finEvery?: number;
  /** Skip glazing below this height (podium / plinth). */
  from?: number;
  /** Floor index to highlight with a warm glow (the subject unit). */
  highlight?: number;
  curtain?: boolean;
}

/** Registers the glass gradients facades use; returns their fills. */
export function glassFills(svg: Svg, pal: Palette) {
  return {
    glass: svg.linear([[0, pal.glassHi], [0.45, mix(pal.glass, pal.glassHi, 0.35)], [1, shade(pal.glass, 0.8)]]),
    lit: svg.linear([[0, mix(pal.lit, '#ffffff', 0.3)], [1, shade(pal.lit, 0.85)]]),
    dark: svg.linear([[0, shade(pal.glass, 0.75)], [1, shade(pal.glass, 0.5)]]),
  };
}

/** Window grid, floor slabs and vertical fins on one face of a building. */
export function facade(cam: Camera, pal: Palette, r: Rng, f: Face, fills: ReturnType<typeof glassFills>, o: FacadeOpts) {
  if (f.name === 'top') return '';
  let s = '';
  const floors = Math.floor((f.h - (o.from ?? 0)) / o.floorH);
  const bay = f.w / o.bays;
  const sideShade = lightOf(pal, f.n) < 0.8;
  for (let fl = 0; fl < floors; fl++) {
    const t0 = (o.from ?? 0) + fl * o.floorH;
    for (let b = 0; b < o.bays; b++) {
      const pad = (bay * (1 - o.glazing)) / 2;
      const on = r.chance(o.litRatio * (sideShade ? 1.2 : 0.8)) || (o.highlight === fl && b % 3 !== 1);
      const fill = on ? fills.lit : sideShade && r.chance(0.5) ? fills.dark : fills.glass;
      s += faceRect(cam, f, b * bay + pad, t0 + o.floorH * 0.22, (b + 1) * bay - pad, t0 + o.floorH * (o.curtain ? 0.98 : 0.86), `fill="${fill}"${on ? ` opacity="${r.range(0.85, 1).toFixed(2)}"` : ''}`, 0.02);
      if (!o.curtain && !on && r.chance(0.35)) {
        // Half-drawn curtain behind the glass.
        s += faceRect(cam, f, b * bay + pad, t0 + o.floorH * 0.22, b * bay + pad + (bay - 2 * pad) * r.range(0.2, 0.45), t0 + o.floorH * 0.86, `fill="${BRAND.stoneLight}" opacity="0.35"`, 0.025);
      }
    }
    s += faceRect(cam, f, 0, t0, f.w, t0 + o.floorH * 0.14, `fill="${lit(pal, o.slab, f.n)}"`, 0.05);
  }
  if (o.fin) {
    const every = o.finEvery ?? 2;
    for (let b = 0; b <= o.bays; b += every) {
      const x = Math.min(f.w - 0.25, Math.max(0, b * bay - 0.12));
      s += faceRect(cam, f, x, o.from ?? 0, x + 0.28, f.h, `fill="${lit(pal, o.fin, f.n)}"`, 0.12);
    }
  }
  return s;
}
