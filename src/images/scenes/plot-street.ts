/** Plot: internal 30/40 ft road with marked plots, kerbs, avenue trees and a few completed homes. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish, ground, haze, quad, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { road, streetLight } from '../scene/street.js';
import { Svg } from '../scene/svg.js';
import { villa } from '../scene/villa.js';
import { plotSize } from './plot-masterplan.js';

export default function plotStreet(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const wide = s.property.area_sqft >= 1800;
  const rw = wide ? 12 : 9;
  const [pw, pd] = plotSize(s.property.area_sqft);
  const cam = camera([r.range(-2, 2), 1.6, -8], { yaw: r.range(-10, 10), fov: 62, w: s.width, h: s.height, cy: 0.6 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  treeLine(svg, cam, pal, r.fork('tl'));
  haze(svg, cam, pal, 0.45);
  ground(svg, cam, pal);
  road(svg, cam, pal, 0, rw, -20, 500);
  const earth = mix('#c9ad84', pal.sun, 0.12);
  const tr = r.fork('t');
  for (const side of [-1, 1]) {
    for (let z = 0, i = 0; z < 300; z += pw, i++) {
      const x0 = side * (rw / 2 + 2.4);
      const x1 = x0 + side * pd;
      const subject = side === 1 && i === 2;
      quad(svg, cam, [[x0, 0.02, z + 0.2], [x1, 0.02, z + 0.2], [x1, 0.02, z + pw - 0.2], [x0, 0.02, z + pw - 0.2]], `fill="${subject ? mix(earth, BRAND.brassLight, 0.45) : shade(earth, tr.range(0.9, 1.05))}"`, 3000);
      // Corner pegs mark every plot; the subject plot gets brass pegs.
      box(svg, cam, pal, [x0 + side * 0.1 - 0.15, 0, z - 0.15], [x0 + side * 0.1 + 0.15, 0.6, z + 0.15], { color: subject ? BRAND.brass : BRAND.stoneLight });
      if (!subject && tr.chance(0.18)) villa(svg, cam, pal, tr, { at: [side > 0 ? x0 + 4 : x1 + 4, 0, z + 1.5], w: Math.min(pd - 8, 12), d: pw - 3, accent: BRAND.stoneDark, litRatio: pal.litRatio, shadow: true });
      else if (tr.chance(0.5)) tree(svg, cam, pal, tr, [x0 + side * tr.range(4, pd - 2), 0, z + tr.range(1, pw - 1)], tr.range(0.8, 1.5), 'shrub');
    }
    for (let z = 4; z < 300; z += 11) tree(svg, cam, pal, tr, [side * (rw / 2 + 1.2), 0, z], tr.range(5.5, 7.5), tr.chance(0.2) ? 'tall' : 'round');
    for (let z = 10; z < 300; z += 30) streetLight(svg, cam, pal, [side * (rw / 2 + 0.6), 0, z], side === 1 ? -1 : 1);
  }
  finish(svg, pal);
  return svg.toString();
}
