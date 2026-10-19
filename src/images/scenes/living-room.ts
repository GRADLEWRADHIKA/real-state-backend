/** Apartment and villa: living room with a big window, sofa group, rug and dining corner. Villas get a double-height volume. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import { artwork, pendant, plant, roomShell, rug, sofa, table } from '../scene/room.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function livingRoom(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const villa = s.property.type === 'Villa';
  const svg = new Svg(s.width, s.height);
  const room = { w: 6.4 * s.proportion, d: 6.8, h: villa ? 5.4 : 3.05 };
  const cam = camera([r.range(-0.5, 0.5), 1.35, -1.2], { yaw: r.range(-8, 8), pitch: villa ? -4 : 0, fov: 74, w: s.width, h: s.height, cy: villa ? 0.6 : 0.52 });
  const ctx = { svg, cam, pal };
  const wall = r.pick(['#ece4d6', '#e8e1d3', '#efe9df']);
  const floor = r.pick(['#b58a63', '#a77b55', '#d7cbb8']);
  const W = room.w / 2;
  roomShell(svg, cam, pal, r, room, {
    wall, floor, planks: floor !== '#d7cbb8', tiles: floor === '#d7cbb8', feature: r.pick([BRAND.green2, mix(BRAND.stone, wall, 0.4), '#5b6b5e']),
    windows: [{ x0: -W + 0.6, x1: W - 0.6, y0: 0.35, y1: room.h - 0.35, mullions: villa ? 4 : 3, low: villa }],
  });
  // Curtains either side of the window.
  for (const x of [-W + 0.15, W - 0.75]) box(svg, cam, pal, [x, 0, room.d - 0.35], [x + 0.6, room.h - 0.1, room.d - 0.15], { color: mix('#f3ece0', pal.sun, 0.1), opacity: 0.92 });
  rug(ctx, -1.9, 2.4, 1.9, 5.2, r.pick(['#d8ccb6', '#c9b79a', '#b9a58c']), shade(BRAND.green, 1.4));
  const fabric = r.pick(['#8c8f7d', '#b9ab95', '#4d5f55', '#a69886']);
  sofa(ctx, -1.6, 4.9, 3.2, fabric);
  sofa(ctx, W - 0.35, 2.2, 2.2, shade(fabric, 1.1), 'right');
  table(ctx, -0.8, 3.2, 0.8, 4.1, 0.4, r.pick(['#5a3f2c', BRAND.stoneDark, '#2d2a26']));
  box(svg, cam, pal, [-0.3, 0.4, 3.5], [0.1, 0.48, 3.8], { color: pal.accent });
  // Media console along the left wall.
  box(svg, cam, pal, [-W, 0, 2.2], [-W + 0.45, 0.55, 5.2], { color: shade('#5a3f2c', 1.1) });
  artwork(ctx, r.fork('art'), { x: -W + 0.01, z0: 2.8, z1: 4.6 }, 1.3, 2.4);
  plant(ctx, r.fork('p1'), W - 0.6, room.d - 0.8, 1.6);
  plant(ctx, r.fork('p2'), -W + 0.5, room.d - 0.6, 1.2);
  // Dining corner nearer the camera on the left.
  table(ctx, -W + 0.5, 0.3, -W + 1.3, 1.6, 0.76, BRAND.stoneLight, '#2f2a25');
  for (const z of [0.5, 1.1]) box(svg, cam, pal, [-W + 1.45, 0, z], [-W + 1.85, 0.46, z + 0.4], { color: pal.accent });
  pendant(ctx, -W + 0.9, 0.95, room.h, villa ? 2.8 : 0.9);
  pendant(ctx, 0, 3.6, room.h, villa ? 3.2 : 0.5, 0.35);
  finish(svg, pal, 0.32);
  return svg.toString();
}
