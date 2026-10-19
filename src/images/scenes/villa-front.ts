/** Villa: front elevation across a lawn, with driveway, boundary wall, gate and mature planting. */
import { camera, type V3 } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish, foregroundFoliage, ground, haze, quad, sky, skyline, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';
import { villa } from '../scene/villa.js';

export default function villaFront(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const W = 14 * s.proportion;
  const cam = camera([r.range(-10, -7), 1.6, -27], { yaw: r.range(16, 20), fov: 58, w: s.width, h: s.height, cy: 0.72 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  skyline(svg, cam, pal, r.fork('sky2'), { height: 0.04, rows: 1 });
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.05 });
  haze(svg, cam, pal, 0.4);
  ground(svg, cam, pal);
  // Street, kerb and the villa's paved driveway.
  quad(svg, cam, [[-200, 0.01, -40], [200, 0.01, -40], [200, 0.01, -14], [-200, 0.01, -14]], `fill="${shade('#77756f', 0.95)}"`, 4000);
  quad(svg, cam, [[-200, 0.02, -14], [200, 0.02, -14], [200, 0.02, -12], [-200, 0.02, -12]], `fill="${BRAND.stoneLight}"`, 4000);
  quad(svg, cam, [[W - 6, 0.02, -12], [W - 0.5, 0.02, -12], [W - 0.5, 0.02, 0], [W - 6, 0.02, 0]], `fill="${mix(BRAND.stone, '#ffffff', 0.25)}"`, 3500);
  for (let z = -11.5; z < 0; z += 1.2) quad(svg, cam, [[W - 6, 0.03, z], [W - 0.5, 0.03, z], [W - 0.5, 0.03, z + 0.05], [W - 6, 0.03, z + 0.05]], `fill="${BRAND.stoneDark}" opacity="0.4"`, 3400);
  // Neighbouring villas set back on either side.
  const nr = r.fork('n');
  for (const nx of [-26, W + 12]) villa(svg, cam, pal, nr, { at: [nx, 0, 10 + nr.range(0, 6)], w: 12, d: 11, accent: pal.accent, litRatio: pal.litRatio, shadow: true });
  villa(svg, cam, pal, r.fork('v'), { at: [0, 0, 0], w: W, d: 12, accent: s.pal.accent, litRatio: Math.min(1, pal.litRatio * (s.occupied ? 1.5 : 1)) });
  // Boundary wall with gate opening at the driveway.
  const bw = r.pick([BRAND.stoneLight, shade(BRAND.stone, 0.95)]);
  box(svg, cam, pal, [-5, 0, -12], [W - 6.5, 1.1, -11.7], { color: bw });
  box(svg, cam, pal, [W, 0, -12], [W + 5, 1.1, -11.7], { color: bw });
  for (const x of [W - 6.8, W]) box(svg, cam, pal, [x, 0, -12.1], [x + 0.5, 1.7, -11.6], { color: shade(bw, 0.85) });
  for (let i = 0; i < 14; i++) box(svg, cam, pal, [W - 6.2 + i * 0.4, 0, -11.95], [W - 6.15 + i * 0.4, 1.4, -11.9], { color: BRAND.green });
  // Garden planting.
  const tr = r.fork('t');
  for (let i = 0; i < Math.round(9 * s.treeDensity); i++) {
    const left = tr.chance(0.55);
    // Planting frames the house from the sides and behind; nothing stands in front of the facade.
    tree(svg, cam, pal, tr, [left ? tr.range(-16, -5) : tr.range(W + 2, W + 12), 0, tr.range(-4, 18)], tr.range(4, 8), tr.pick(['round', 'tall', 'round'] as const));
  }
  tree(svg, cam, pal, tr, [-2.5, 0, -3], 6.5, 'palm');
  for (let i = 0; i < 26; i++) tree(svg, cam, pal, tr, [tr.range(-4, W - 7), 0, tr.range(-11.3, -10.5)], tr.range(0.9, 1.4), 'shrub');
  for (let i = 0; i < 10; i++) tree(svg, cam, pal, tr, [tr.range(-3, W * 0.3), 0, tr.range(-2.5, -1)], tr.range(0.8, 1.2), 'shrub');
  // Street trees.
  for (let x = -40; x < 60; x += 12) if (x < -8 || x > W + 4) tree(svg, cam, pal, tr, [x + tr.range(-1, 1), 0, -15], tr.range(6, 8), 'round');
  foregroundFoliage(svg, pal, r.fork('fg'), 'left', 1);
  finish(svg, pal);
  return svg.toString();
}
