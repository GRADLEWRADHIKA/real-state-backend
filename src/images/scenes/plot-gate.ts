/** Plot: township entrance gate with guard room, boom barrier and the avenue beyond. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, castShadow, finish, foregroundFoliage, ground, haze, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { road, streetLight } from '../scene/street.js';
import { Svg } from '../scene/svg.js';

export default function plotGate(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const cam = camera([r.range(-4, 4), 1.6, -30], { yaw: r.range(-6, 6), fov: 60, w: s.width, h: s.height, cy: 0.62 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.05 });
  haze(svg, cam, pal, 0.45);
  ground(svg, cam, pal);
  road(svg, cam, pal, 0, 12, -60, 600);
  const stone = r.pick([BRAND.stone, '#cbb995', shade(BRAND.stone, 0.92)]);
  // Pillars, the spanning beam with a blank brass plaque, and the boundary wall.
  for (const x of [-9.5, 7.5]) {
    castShadow(svg, cam, pal, [x, 0, -1], [x + 2, 8.5, 1]);
    box(svg, cam, pal, [x, 0, -1], [x + 2, 8.5, 1], { color: stone });
    box(svg, cam, pal, [x - 0.2, 8.5, -1.2], [x + 2.2, 9, 1.2], { color: BRAND.green });
  }
  box(svg, cam, pal, [-7.5, 7, -0.6], [7.5, 8.2, 0.6], { color: BRAND.green, top: BRAND.green2 });
  box(svg, cam, pal, [-3.5, 7.2, -0.68], [3.5, 8.0, -0.6], { color: mix(BRAND.brass, BRAND.brassLight, 0.3) });
  for (const [a, b] of [[-90, -9.5], [9.5, 90]]) {
    box(svg, cam, pal, [a, 0, -0.3], [b, 2.2, 0.3], { color: shade(stone, 1.05) });
    box(svg, cam, pal, [a, 2.2, -0.35], [b, 2.35, 0.35], { color: BRAND.green });
  }
  // Guard room and boom barrier.
  box(svg, cam, pal, [11, 0, 2], [15, 3, 6], { color: BRAND.stoneLight });
  box(svg, cam, pal, [10.6, 3, 1.6], [15.4, 3.3, 6.4], { color: BRAND.green });
  box(svg, cam, pal, [4.8, 0, -1.8], [5.4, 1.1, -1.2], { color: '#c94b3d' });
  box(svg, cam, pal, [-4.5, 0.9, -1.6], [5.0, 1.02, -1.45], { color: '#f2efe8' });
  const tr = r.fork('t');
  for (let z = 6; z < 300; z += 10) for (const x of [-9, 9]) tree(svg, cam, pal, tr, [x, 0, z], tr.range(6, 8), z < 20 ? 'palm' : 'round');
  for (let z = 10; z < 300; z += 25) streetLight(svg, cam, pal, [-7.5, 0, z], 1);
  for (let i = 0; i < Math.round(16 * s.treeDensity); i++) tree(svg, cam, pal, tr, [tr.chance(0.5) ? tr.range(-60, -12) : tr.range(16, 60), 0, tr.range(-20, 60)], tr.range(5, 9));
  for (let i = 0; i < 30; i++) tree(svg, cam, pal, tr, [tr.chance(0.5) ? tr.range(-40, -11) : tr.range(10, 40), 0, tr.range(-2.5, -1)], tr.range(0.8, 1.4), 'shrub');
  foregroundFoliage(svg, pal, r.fork('fg'), 'both', 0.8);
  finish(svg, pal);
  return svg.toString();
}
