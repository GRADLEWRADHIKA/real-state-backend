/** Street furniture shared by the plot and commercial scenes. */
import type { Camera, V3 } from './camera.js';
import { box, quad } from './kit.js';
import { BRAND, type Palette } from './palette.js';
import type { Svg } from './svg.js';

/** Road along z from z0 to z1, centred on x, with kerbs and a dashed centre line. */
export function road(svg: Svg, cam: Camera, pal: Palette, x: number, width: number, z0: number, z1: number) {
  const h = width / 2;
  quad(svg, cam, [[x - h, 0.01, z0], [x + h, 0.01, z0], [x + h, 0.01, z1], [x - h, 0.01, z1]], `fill="#77766f"`, 4000);
  for (const side of [-1, 1]) {
    const k = x + side * h;
    quad(svg, cam, [[k, 0.015, z0], [k + side * 2.2, 0.015, z0], [k + side * 2.2, 0.015, z1], [k, 0.015, z1]], `fill="${BRAND.stoneLight}"`, 3900);
    quad(svg, cam, [[k, 0.016, z0], [k + side * 0.25, 0.016, z0], [k + side * 0.25, 0.016, z1], [k, 0.016, z1]], `fill="#d9d2c4"`, 3850);
  }
  for (let z = z0; z < z1; z += 8) quad(svg, cam, [[x - 0.08, 0.02, z], [x + 0.08, 0.02, z], [x + 0.08, 0.02, z + 3.5], [x - 0.08, 0.02, z + 3.5]], `fill="#efe8d8" opacity="0.85"`, 3800);
}

export function streetLight(svg: Svg, cam: Camera, pal: Palette, at: V3, side: 1 | -1) {
  const [x, , z] = at;
  box(svg, cam, pal, [x - 0.06, 0, z - 0.06], [x + 0.06, 6, z + 0.06], { color: '#3a3f3c' });
  box(svg, cam, pal, [Math.min(x, x + side * 1.2), 5.9, z - 0.08], [Math.max(x, x + side * 1.2), 6.05, z + 0.08], { color: '#3a3f3c' });
  box(svg, cam, pal, [x + side * 1.2 - 0.25, 5.8, z - 0.15], [x + side * 1.2 + 0.25, 5.95, z + 0.15], { color: pal.time === 'dusk' ? pal.lit : '#d9d5cc' });
}

export function bench(svg: Svg, cam: Camera, pal: Palette, x: number, z: number, alongZ = false) {
  const [w, d] = alongZ ? [0.5, 1.6] : [1.6, 0.5];
  box(svg, cam, pal, [x, 0.4, z], [x + w, 0.46, z + d], { color: '#8a6a4e' });
  box(svg, cam, pal, [x + 0.05, 0, z + 0.05], [x + w - 0.05, 0.4, z + d - 0.05], { color: '#4a4f4c', opacity: 0.9 });
}
