/** Commercial / office / shop: glass-facade block seen across the street, blank signage band, shopfronts. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { facade, glassFills } from '../scene/facade.js';
import { box, castShadow, finish, ground, haze, quad, sky, skyline, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { road, streetLight } from '../scene/street.js';
import { Svg } from '../scene/svg.js';

export default function commercialFacade(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const W = 46 * s.proportion;
  const H = 4.8 + (s.storeys - 1) * 3.8;
  const cam = camera([r.range(-12, -4), 1.7, -34], { yaw: r.range(10, 18), fov: 60, w: s.width, h: s.height, cy: 0.66 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  skyline(svg, cam, pal, r.fork('sk'), { height: 0.07 });
  treeLine(svg, cam, pal, r.fork('tl'));
  haze(svg, cam, pal, 0.4);
  ground(svg, cam, pal, shade(BRAND.stone, 0.85), pal.haze);
  // Main road in front, running across the view.
  quad(svg, cam, [[-300, 0.01, -26], [300, 0.01, -26], [300, 0.01, -8], [-300, 0.01, -8]], `fill="#74736d"`, 4000);
  for (let x = -300; x < 300; x += 9) quad(svg, cam, [[x, 0.02, -17.1], [x + 4, 0.02, -17.1], [x + 4, 0.02, -16.9], [x, 0.02, -16.9]], `fill="#efe8d8"`, 3900);
  quad(svg, cam, [[-300, 0.02, -8], [300, 0.02, -8], [300, 0.02, 0], [-300, 0.02, 0]], `fill="${BRAND.stoneLight}"`, 3800);
  void road;
  const fills = glassFills(svg, pal);
  const x0 = -W / 2;
  castShadow(svg, cam, pal, [x0, 0, 0], [x0 + W, H, 22]);
  box(svg, cam, pal, [x0, 0, 0], [x0 + W, H, 22], {
    color: mix(pal.glass, BRAND.stoneLight, 0.35),
    decorate: (f) => facade(cam, pal, r, f, fills, { floorH: 3.8, bays: Math.round(f.w / 2.2), glazing: 0.94, litRatio: pal.litRatio * 1.2, slab: BRAND.stoneLight, from: 4.8, curtain: true, fin: s.pal.accent, finEvery: 4 }),
  });
  // Ground-floor shopfronts, the blank signage band above them, and a canopy.
  box(svg, cam, pal, [x0 + 0.3, 0, -0.2], [x0 + W - 0.3, 4.8, 0.2], { color: BRAND.stone, decorate: (f) => facade(cam, pal, r, f, fills, { floorH: 3.6, bays: Math.round(f.w / 6), glazing: 0.88, litRatio: pal.time === 'dusk' ? 1 : 0.55, slab: BRAND.stone, curtain: true }) });
  box(svg, cam, pal, [x0 + 0.3, 3.7, -0.5], [x0 + W - 0.3, 4.6, -0.2], { color: BRAND.green });
  for (let x = x0 + 2; x < x0 + W - 4; x += 6) box(svg, cam, pal, [x, 3.85, -0.56], [x + 4, 4.45, -0.5], { color: mix(BRAND.brass, '#ffffff', 0.1) });
  box(svg, cam, pal, [x0, 3.3, -2.6], [x0 + W, 3.5, -0.2], { color: BRAND.green2 });
  box(svg, cam, pal, [x0 - 0.3, H, -0.3], [x0 + W + 0.3, H + 1.2, 22.3], { color: BRAND.stoneLight });
  const tr = r.fork('t');
  for (let x = x0 - 20; x < x0 + W + 30; x += 10) {
    box(svg, cam, pal, [x - 0.8, 0, -6.5], [x + 0.8, 0.5, -4.9], { color: BRAND.stoneDark });
    tree(svg, cam, pal, tr, [x, 0.5, -5.7], tr.range(5, 7));
  }
  for (let x = x0 - 15; x < x0 + W + 30; x += 20) streetLight(svg, cam, pal, [x, 0, -7.4], -1);
  for (const nx of [x0 - 40, x0 + W + 8]) {
    const h = 10 + tr.range(0, 10);
    box(svg, cam, pal, [nx, 0, 6], [nx + 30, h, 26], { color: mix(BRAND.stone, pal.haze, 0.35), decorate: (f) => facade(cam, pal, tr, f, fills, { floorH: 3.6, bays: 8, glazing: 0.6, litRatio: pal.litRatio, slab: BRAND.stone }) });
  }
  finish(svg, pal);
  return svg.toString();
}
