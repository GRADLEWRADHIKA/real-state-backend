/** Commercial: street-level view along the shop frontage with blank signage, awnings and planters. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { facade, glassFills } from '../scene/facade.js';
import { box, castShadow, finish, ground, haze, quad, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { bench, streetLight } from '../scene/street.js';
import { Svg } from '../scene/svg.js';

export default function commercialStreet(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const H = 4.8 + (s.storeys - 1) * 3.8;
  // Standing on the pavement, looking down the frontage (+z).
  const cam = camera([-7, 1.65, -6], { yaw: r.range(14, 22), fov: 66, w: s.width, h: s.height, cy: 0.6 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'));
  treeLine(svg, cam, pal, r.fork('tl'));
  haze(svg, cam, pal, 0.5);
  ground(svg, cam, pal, shade(BRAND.stone, 0.85), pal.haze);
  quad(svg, cam, [[-24, 0.01, -50], [-9, 0.01, -50], [-9, 0.01, 400], [-24, 0.01, 400]], `fill="#74736d"`, 4000);
  quad(svg, cam, [[-9, 0.02, -50], [0, 0.02, -50], [0, 0.02, 400], [-9, 0.02, 400]], `fill="${BRAND.stoneLight}"`, 3900);
  for (let z = -50; z < 400; z += 1.5) quad(svg, cam, [[-9, 0.03, z], [0, 0.03, z], [0, 0.03, z + 0.03], [-9, 0.03, z + 0.03]], `fill="${BRAND.stoneDark}" opacity="0.25"`, 3850);
  const fills = glassFills(svg, pal);
  castShadow(svg, cam, pal, [0, 0, -10], [22, H, 140], 0, 0.7);
  box(svg, cam, pal, [0, 0, -10], [22, H, 140], { color: BRAND.stoneLight, decorate: (f) => facade(cam, pal, r, f, fills, { floorH: 3.8, bays: Math.round(f.w / 3), glazing: 0.75, litRatio: pal.litRatio, slab: BRAND.stone, from: 4.8, fin: s.pal.accent, finEvery: 3 }) });
  // Units: glass shopfront, blank signboard, awning.
  const sr = r.fork('shops');
  for (let z = -10; z < 140; z += 7) {
    const awn = sr.pick([BRAND.green, s.pal.accent, '#4d5f55', BRAND.green2]);
    box(svg, cam, pal, [-0.25, 0, z + 0.2], [0, 3.4, z + 6.8], { color: mix(pal.glass, '#ffffff', 0.1), decorate: (f) => facade(cam, pal, sr, f, fills, { floorH: 3.4, bays: 2, glazing: 0.9, litRatio: pal.time === 'dusk' ? 1 : 0.6, slab: BRAND.stone, curtain: true }) });
    box(svg, cam, pal, [-0.4, 3.6, z + 0.6], [-0.25, 4.4, z + 6.4], { color: mix(BRAND.brass, BRAND.stoneLight, 0.2) });
    box(svg, cam, pal, [-1.8, 3.2, z + 0.4], [-0.25, 3.35, z + 6.6], { color: awn });
  }
  const tr = r.fork('t');
  for (let z = -4; z < 140; z += 9) {
    box(svg, cam, pal, [-7.6, 0, z - 0.6], [-6.4, 0.5, z + 0.6], { color: BRAND.stoneDark });
    tree(svg, cam, pal, tr, [-7, 0.5, z], tr.range(4.5, 6));
  }
  for (let z = 2; z < 140; z += 18) streetLight(svg, cam, pal, [-8.6, 0, z], -1);
  for (let z = 6; z < 60; z += 18) bench(svg, cam, pal, -5.2, z, true);
  for (let z = -40; z < 300; z += 14) tree(svg, cam, pal, tr, [-27 - tr.range(0, 6), 0, z], tr.range(6, 9));
  finish(svg, pal);
  return svg.toString();
}
