/** Entrance lobby: double-height space, stone floor, reception desk, lounge seating and a green wall. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import { artwork, pendant, plant, roomShell, rug, sofa } from '../scene/room.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function lobby(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const room = { w: 11 * s.proportion, d: 12, h: 6 };
  const W = room.w / 2;
  const cam = camera([r.range(-1.5, 1.5), 1.6, 0.3], { yaw: r.range(-6, 6), pitch: -3, fov: 76, w: s.width, h: s.height, cy: 0.56 });
  const ctx = { svg, cam, pal };
  roomShell(svg, cam, pal, r, room, { wall: '#e9e1d2', floor: '#e3dacb', tiles: true, feature: mix(BRAND.stone, '#ffffff', 0.15), windows: [{ x0: 1.0, x1: W - 0.4, y0: 0.2, y1: room.h - 0.4, mullions: 4, low: true }] });
  // Green wall and brass slats on the left.
  box(svg, cam, pal, [-W, 0.4, 3], [-W + 0.15, room.h - 0.6, 10], { color: BRAND.green3 });
  for (let z = 3.2; z < 9.9; z += 0.45) box(svg, cam, pal, [-W + 0.12, 0.5, z], [-W + 0.22, room.h - 0.7, z + 0.2], { color: r.pick(pal.foliage), ao: false });
  for (let x = -W + 0.6; x < 0.6; x += 0.35) box(svg, cam, pal, [x, 0, room.d - 0.2], [x + 0.08, room.h, room.d - 0.1], { color: s.pal.accent });
  // Reception desk.
  box(svg, cam, pal, [-2.6, 0, 8.4], [0.4, 1.05, 9.2], { color: BRAND.stoneLight });
  box(svg, cam, pal, [-2.7, 1.05, 8.3], [0.5, 1.12, 9.3], { color: BRAND.green });
  artwork(ctx, r.fork('art'), { z: room.d - 0.22, x0: -2.4, x1: -0.2 }, 2.2, 3.8);
  // Lounge.
  rug(ctx, 0.8, 3.0, 4.4, 6.4, '#cbbca3', BRAND.brass);
  sofa(ctx, 1.1, 5.9, 2.8, r.pick(['#4d5f55', '#8c7a66', BRAND.green2]));
  box(svg, cam, pal, [1.9, 0, 3.9], [3.2, 0.38, 4.7], { color: shade('#5a3f2c', 1.1) });
  plant(ctx, r.fork('p1'), 4.6, 6.4, 1.8);
  plant(ctx, r.fork('p2'), -W + 1.0, 2.2, 1.6);
  for (const [x, z] of [[-1, 5], [2.5, 4.5], [-1.2, 8.8]]) pendant(ctx, x, z, room.h, 2.2, 0.45);
  finish(svg, pal, 0.3);
  return svg.toString();
}
