/** Apartment amenities: clubhouse and pool deck with the residential towers behind. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { facade, glassFills } from '../scene/facade.js';
import { box, castShadow, finish, foregroundFoliage, ground, haze, quad, sky, skyline, tree, treeDefs } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';
import { lounger, pool, umbrella } from '../scene/villa.js';

export default function poolAmenities(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const cam = camera([r.range(-8, -4), 1.7, -16], { yaw: r.range(8, 16), fov: 64, w: s.width, h: s.height, cy: 0.66 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  skyline(svg, cam, pal, r.fork('sk'), { height: 0.05 });
  haze(svg, cam, pal, 0.4);
  ground(svg, cam, pal);
  const fills = glassFills(svg, pal);
  // Towers in the background.
  for (const [x, z, n] of [[-30, 60, s.storeys], [10, 75, s.storeys - 2]] as const) {
    castShadow(svg, cam, pal, [x, 0, z], [x + 22, 6 + n * 3.1, z + 16], 0, 0.6);
    box(svg, cam, pal, [x, 0, z], [x + 22, 6 + n * 3.1, z + 16], { color: BRAND.stoneLight, decorate: (f) => facade(cam, pal, r, f, fills, { floorH: 3.1, bays: 6, glazing: 0.6, litRatio: pal.litRatio, slab: BRAND.stone, from: 6, fin: s.pal.accent, finEvery: 3 }) });
  }
  // Clubhouse pavilion with deep roof.
  castShadow(svg, cam, pal, [-14, 0, 18], [6, 4.5, 30]);
  box(svg, cam, pal, [-14, 0, 18], [6, 4.2, 30], { color: BRAND.stoneLight, decorate: (f) => facade(cam, pal, r, f, fills, { floorH: 4.2, bays: 6, glazing: 0.85, litRatio: pal.time === 'dusk' ? 1 : 0.5, slab: BRAND.stone, curtain: true }) });
  box(svg, cam, pal, [-15.5, 4.2, 16.5], [7.5, 4.7, 31.5], { color: BRAND.green, top: BRAND.green2 });
  // Deck and pool.
  quad(svg, cam, [[-18, 0.02, -2], [16, 0.02, -2], [16, 0.02, 17.5], [-18, 0.02, 17.5]], `fill="${mix(BRAND.stoneLight, pal.sun, 0.08)}"`, 3000);
  pool(svg, cam, pal, r.fork('pool'), -12, 6, 10, 14);
  const lr = r.fork('l');
  for (let i = 0; i < 5; i++) lounger(svg, cam, pal, -11 + i * 1.5, 1.5, lr.pick([pal.accent, BRAND.green3, '#e8dcc6']));
  umbrella(svg, cam, pal, -3, 2.5, mix(BRAND.stoneLight, pal.accent, 0.3));
  umbrella(svg, cam, pal, 3.5, 2.5, mix(BRAND.stoneLight, pal.accent, 0.3));
  const tr = r.fork('t');
  for (const x of [-16, 12, 14]) tree(svg, cam, pal, tr, [x, 0, tr.range(4, 16)], tr.range(7, 9), 'palm');
  for (let i = 0; i < Math.round(10 * s.treeDensity); i++) tree(svg, cam, pal, tr, [tr.chance(0.5) ? tr.range(-40, -18) : tr.range(14, 40), 0, tr.range(0, 50)], tr.range(5, 9));
  for (let i = 0; i < 16; i++) tree(svg, cam, pal, tr, [tr.range(-18, 16), 0, tr.range(16.5, 17.5)], tr.range(0.8, 1.3), 'shrub');
  box(svg, cam, pal, [-18, 0, -2.4], [16, 0.45, -2], { color: shade(BRAND.stone, 0.95) });
  foregroundFoliage(svg, pal, r.fork('fg'), 'left', 0.9);
  finish(svg, pal);
  return svg.toString();
}
