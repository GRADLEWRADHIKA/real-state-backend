/** Master bedroom: upholstered bed against a feature wall, side tables, lamps and a window seat. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import { artwork, pendant, plant, roomShell, rug } from '../scene/room.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function bedroom(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const room = { w: 4.8 * s.proportion, d: 5.2, h: 3 };
  const W = room.w / 2;
  const cam = camera([r.range(-1.1, -0.6), 1.4, 0.2], { yaw: r.range(10, 18), fov: 72, w: s.width, h: s.height, cy: 0.5 });
  const ctx = { svg, cam, pal };
  const wall = r.pick(['#ebe3d5', '#e6ddd0']);
  const feature = r.pick([BRAND.green2, '#6d7c70', '#8a6f5a', mix(BRAND.stone, '#ffffff', 0.2)]);
  roomShell(svg, cam, pal, r, room, { wall, floor: r.pick(['#b8916b', '#a98460']), planks: true, feature: wall, windows: [{ x0: W - 2.2, x1: W - 0.3, y0: 0.6, y1: 2.6, mullions: 2 }] });
  // Feature headboard wall panel on the back wall, left half.
  box(svg, cam, pal, [-W, 0, room.d - 0.06], [W - 2.5, room.h, room.d], { color: feature });
  const bx0 = -W + 0.4;
  const bx1 = bx0 + 1.9;
  rug(ctx, bx0 - 0.5, 1.6, bx1 + 0.5, room.d - 0.2, r.pick(['#d9cdb8', '#cdbfa6']));
  box(svg, cam, pal, [bx0 - 0.1, 0, room.d - 0.2], [bx1 + 0.1, 1.25, room.d - 0.06], { color: shade(feature, 1.25) });
  box(svg, cam, pal, [bx0, 0, room.d - 2.3], [bx1, 0.42, room.d - 0.2], { color: '#6b5a49' });
  box(svg, cam, pal, [bx0 + 0.02, 0.42, room.d - 2.28], [bx1 - 0.02, 0.6, room.d - 0.22], { color: '#f6f2ea' });
  box(svg, cam, pal, [bx0 + 0.02, 0.6, room.d - 2.3], [bx1 - 0.02, 0.66, room.d - 1.2], { color: r.pick([pal.accent, '#c9b48f', '#7d9a7e']) });
  for (const x of [bx0 + 0.15, bx0 + 1.0]) box(svg, cam, pal, [x, 0.6, room.d - 0.65], [x + 0.75, 0.82, room.d - 0.3], { color: '#fbf8f2' });
  for (const x of [bx0 - 0.55, bx1 + 0.05]) {
    box(svg, cam, pal, [x, 0, room.d - 0.65], [x + 0.5, 0.5, room.d - 0.2], { color: '#4a3b2f' });
    pendant(ctx, x + 0.25, room.d - 0.42, room.h, 1.6, 0.15);
  }
  artwork(ctx, r.fork('art'), { z: room.d - 0.07, x0: bx0 + 0.3, x1: bx1 - 0.3 }, 1.5, 2.3);
  // Window seat and wardrobe on the right wall.
  box(svg, cam, pal, [W - 2.3, 0, room.d - 0.7], [W - 0.2, 0.45, room.d - 0.05], { color: BRAND.stoneLight });
  box(svg, cam, pal, [W - 0.65, 0, 0.4], [W, 2.5, 2.2], { color: mix('#d9cdb8', wall, 0.3) });
  plant(ctx, r.fork('p'), W - 0.45, room.d - 1.1, 1.1);
  finish(svg, pal, 0.32);
  return svg.toString();
}
