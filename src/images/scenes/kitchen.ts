/** Modular kitchen: L-shaped counters with upper cabinets, an island with stools and pendant lights. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import { pendant, plant, roomShell } from '../scene/room.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function kitchen(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const room = { w: 5.2 * s.proportion, d: 5.4, h: 3 };
  const W = room.w / 2;
  const cam = camera([r.range(0.6, 1.0), 1.6, -1.4], { yaw: r.range(-12, -6), pitch: 4, fov: 70, w: s.width, h: s.height, cy: 0.52 });
  const ctx = { svg, cam, pal };
  const cab = r.pick([BRAND.green2, '#3f4a44', '#e9e1d2', '#7a6a58']);
  const counter = r.pick(['#efeae2', '#d8d0c4', '#2b2b2b']);
  roomShell(svg, cam, pal, r, room, { wall: '#ece6dc', floor: '#d9d0c2', tiles: true, windows: [{ x0: -0.7, x1: 0.9, y0: 1.2, y1: 2.5, mullions: 2 }] });
  const D = room.d;
  // Back run with sink under the window, left run along the wall.
  box(svg, cam, pal, [-W, 0, D - 0.62], [W - 0.4, 0.86, D], { color: cab });
  box(svg, cam, pal, [-W, 0.86, D - 0.65], [W - 0.4, 0.92, D], { color: counter });
  box(svg, cam, pal, [-W, 0, 1.0], [-W + 0.62, 0.86, D - 0.62], { color: cab });
  box(svg, cam, pal, [-W, 0.86, 1.0], [-W + 0.65, 0.92, D - 0.62], { color: counter });
  // Backsplash and upper cabinets.
  box(svg, cam, pal, [-W, 0.92, D - 0.03], [W - 0.4, 1.2, D], { color: mix(pal.accent, '#ffffff', 0.55) });
  box(svg, cam, pal, [-W, 1.6, D - 0.38], [-0.9, 2.4, D], { color: shade(cab, 1.08) });
  box(svg, cam, pal, [1.0, 1.6, D - 0.38], [W - 0.4, 2.4, D], { color: shade(cab, 1.08) });
  box(svg, cam, pal, [-W, 1.6, 1.0], [-W + 0.38, 2.4, D - 0.38], { color: shade(cab, 1.08) });
  // Tall unit (fridge) on the right.
  box(svg, cam, pal, [W - 0.4, 0, D - 0.7], [W, 2.3, D], { color: '#bfc2c0' });
  // Hob and hood on the left run.
  box(svg, cam, pal, [-W + 0.08, 0.92, 2.6], [-W + 0.58, 0.94, 3.3], { color: '#1e1e1e' });
  box(svg, cam, pal, [-W, 1.65, 2.55], [-W + 0.5, 2.0, 3.35], { color: '#9ea3a1' });
  // Island with stools and pendants.
  box(svg, cam, pal, [-0.6, 0, 2.5], [1.0, 0.9, 3.2], { color: shade(cab, 0.95) });
  box(svg, cam, pal, [-0.7, 0.9, 2.45], [1.1, 0.96, 3.3], { color: counter === '#2b2b2b' ? '#efeae2' : counter });
  for (const x of [-0.3, 0.2, 0.7]) {
    box(svg, cam, pal, [x - 0.17, 0.62, 2.0], [x + 0.17, 0.68, 2.32], { color: pal.accent, ao: false });
    box(svg, cam, pal, [x - 0.02, 0, 2.14], [x + 0.02, 0.62, 2.18], { color: '#2b2b2b' });
    pendant(ctx, x + 0.05, 2.85, room.h, 1.0, 0.16);
  }
  box(svg, cam, pal, [0.3, 0.96, 2.8], [0.6, 1.06, 3.1], { color: '#c97b4a' });
  plant(ctx, r.fork('p'), W - 0.5, 0.6, 1.2);
  finish(svg, pal, 0.3);
  return svg.toString();
}
