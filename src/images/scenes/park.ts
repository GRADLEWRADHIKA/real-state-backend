/** Plot amenity: landscaped park with a looping walking path, gazebo, benches and play area. */
import { camera, type V3 } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish, foregroundFoliage, ground, haze, quad, sky, skyline, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { bench } from '../scene/street.js';
import { Svg } from '../scene/svg.js';

export default function park(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const cam = camera([r.range(-4, 4), 1.7, -5], { yaw: r.range(-12, 12), fov: 66, w: s.width, h: s.height, cy: 0.6 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  skyline(svg, cam, pal, r.fork('sk'), { height: 0.035, rows: 1 });
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.05 });
  haze(svg, cam, pal, 0.45);
  ground(svg, cam, pal);
  // Looping path (an ellipse ring on the ground).
  const ring = (rx: number, rz: number): V3[] => Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2) * rx, 0.02, 18 + Math.sin((i / 48) * Math.PI * 2) * rz] as V3);
  quad(svg, cam, ring(26, 20), `fill="${mix(BRAND.stoneLight, pal.sun, 0.08)}"`, 3000);
  quad(svg, cam, ring(23.5, 17.5), `fill="${mix(pal.grass, '#86ad66', 0.3)}"`, 2990);
  // Flower beds.
  for (const [x, z, c] of [[-8, 6, s.pal.accent], [9, 9, '#d9b44a'], [-3, 28, '#c9705a']] as const) {
    const bed = Array.from({ length: 20 }, (_, i) => [x + Math.cos((i / 20) * Math.PI * 2) * 3, 0.03, z + Math.sin((i / 20) * Math.PI * 2) * 1.6] as V3);
    quad(svg, cam, bed, `fill="${shade(pal.foliage[1], 0.8)}"`, 2980);
    quad(svg, cam, bed.map(([a, b, c2]) => [x + (a - x) * 0.7, b + 0.2, z + (c2 - z) * 0.7] as V3), `fill="${c}" opacity="0.85"`, 2970);
  }
  // Gazebo.
  const gx = r.range(6, 12);
  for (const [x, z] of [[gx, 24], [gx + 4, 24], [gx, 28], [gx + 4, 28]]) box(svg, cam, pal, [x, 0, z], [x + 0.25, 2.8, z + 0.25], { color: BRAND.stoneLight });
  box(svg, cam, pal, [gx - 0.6, 2.8, 23.4], [gx + 4.85, 3.2, 28.85], { color: BRAND.green, top: BRAND.green2 });
  // Play area with soft flooring.
  quad(svg, cam, [[-18, 0.03, 14], [-11, 0.03, 14], [-11, 0.03, 20], [-18, 0.03, 20]], `fill="#b8674a" opacity="0.8"`, 2960);
  box(svg, cam, pal, [-17, 0, 15], [-16.6, 2.2, 15.4], { color: s.pal.accent });
  box(svg, cam, pal, [-13, 0, 15], [-12.6, 2.2, 15.4], { color: s.pal.accent });
  box(svg, cam, pal, [-17, 2.2, 15], [-12.6, 2.4, 15.4], { color: BRAND.green });
  box(svg, cam, pal, [-15.5, 0, 17.5], [-13.5, 1.0, 18.8], { color: '#d9b44a' });
  for (const [x, z] of [[-20, 6], [5, 1.5], [20, 12]]) bench(svg, cam, pal, x, z);
  const tr = r.fork('t');
  for (let i = 0; i < Math.round(26 * s.treeDensity); i++) {
    const a = tr.range(0, Math.PI * 2);
    const d = tr.range(1.15, 1.8);
    const z = 18 + Math.sin(a) * 20 * d;
    if (z < 2) continue;
    tree(svg, cam, pal, tr, [Math.cos(a) * 26 * d, 0, z], tr.range(5, 10), tr.pick(['round', 'round', 'tall'] as const));
  }
  for (let i = 0; i < 4; i++) tree(svg, cam, pal, tr, [tr.range(-10, 10), 0, tr.range(10, 26)], tr.range(5, 8));
  foregroundFoliage(svg, pal, r.fork('fg'), 'both', 0.8);
  finish(svg, pal);
  return svg.toString();
}
