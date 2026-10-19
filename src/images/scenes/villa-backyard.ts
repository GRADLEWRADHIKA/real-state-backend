/** Villa: rear garden with pool, deck, loungers and the glazed living room opening onto it. */
import { camera } from '../scene/camera.js';
import { mix } from '../scene/color.js';
import { finish, foregroundFoliage, ground, haze, quad, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';
import { lounger, pool, umbrella, villa } from '../scene/villa.js';

export default function villaBackyard(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const W = 14 * s.proportion;
  // Looking back at the rear of the house from the far corner of the garden.
  const cam = camera([W * 0.5 + r.range(2, 5), 1.7, 36], { yaw: 180 + r.range(4, 9), fov: 64, w: s.width, h: s.height, cy: 0.62 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.06 });
  haze(svg, cam, pal, 0.35);
  ground(svg, cam, pal);
  villa(svg, cam, pal, r.fork('v'), { at: [0, 0, 0], w: W, d: 12, accent: s.pal.accent, litRatio: pal.time === 'dusk' ? 0.9 : 0.4 });
  // Deck, pool and loungers.
  quad(svg, cam, [[-1, 0.02, 12], [W + 1, 0.02, 12], [W + 1, 0.02, 17], [-1, 0.02, 17]], `fill="${mix('#9c7553', pal.sun, 0.1)}"`, 3000);
  for (let x = -1; x < W + 1; x += 0.3) quad(svg, cam, [[x, 0.03, 12], [x + 0.02, 0.03, 12], [x + 0.02, 0.03, 17], [x, 0.03, 17]], `fill="#6b4f37" opacity="0.4"`, 2900);
  pool(svg, cam, pal, r.fork('pool'), 1, 18.5, W - 1, 24);
  const pr = r.fork('l');
  for (let i = 0; i < 3; i++) lounger(svg, cam, pal, 2 + i * 1.3, 13.2, pr.pick([pal.accent, BRAND.green3, '#d9cdb8']));
  umbrella(svg, cam, pal, 6.6, 14.2, mix(BRAND.stoneLight, pal.accent, 0.25));
  // Garden boundary planting.
  const tr = r.fork('t');
  for (let i = 0; i < Math.round(12 * s.treeDensity); i++) tree(svg, cam, pal, tr, [tr.chance(0.5) ? tr.range(-12, -3) : tr.range(W + 3, W + 12), 0, tr.chance(0.5) ? tr.range(-6, 4) : tr.range(-4, 26)], tr.range(4, 8), tr.pick(['round', 'tall', 'palm'] as const));
  for (let i = 0; i < 20; i++) tree(svg, cam, pal, tr, [tr.range(-2, W + 2), 0, tr.range(24.8, 26)], tr.range(0.8, 1.4), 'shrub');
  foregroundFoliage(svg, pal, r.fork('fg'), 'right', 1);
  finish(svg, pal);
  return svg.toString();
}
