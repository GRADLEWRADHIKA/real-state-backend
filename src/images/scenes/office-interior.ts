/** Office: open-plan floor with desks and a meeting room. Shop: retail interior with display shelving. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import { pendant, plant, roomShell, table } from '../scene/room.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

export default function officeInterior(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const shop = s.property.type === 'Shop' || (s.property.type === 'Commercial' && s.property.area_sqft >= 2000);
  const svg = new Svg(s.width, s.height);
  const room = { w: Math.min(14, 5 + Math.sqrt(s.property.area_sqft) * 0.2) * s.proportion, d: shop ? 9 : 12, h: shop ? 4.2 : 3.3 };
  const W = room.w / 2;
  const cam = camera([r.range(-1, 1), 1.6, 0.3], { yaw: r.range(-8, 8), fov: 76, w: s.width, h: s.height, cy: 0.52 });
  const ctx = { svg, cam, pal };
  roomShell(svg, cam, pal, r, room, { wall: '#ece8e1', floor: shop ? '#d8d2c8' : '#9a958c', tiles: shop, planks: !shop, feature: shop ? BRAND.green2 : '#e3ddd3', windows: [{ x0: -W + 0.3, x1: W - 0.3, y0: 0.15, y1: room.h - 0.3, mullions: 6 }] });
  if (shop) {
    for (const x of [-W + 0.1, W - 0.6]) for (let k = 0; k < 4; k++) {
      const z = 1.5 + k * 1.6;
      box(svg, cam, pal, [x, 0, z], [x + 0.5, 2.2, z + 1.3], { color: '#f3eee6' });
      for (const y of [0.5, 1.0, 1.5, 2.0]) box(svg, cam, pal, [x + 0.05, y, z + 0.1], [x + 0.48, y + 0.25, z + 1.2], { color: r.pick([pal.accent, '#c9b48f', '#7d9a7e', '#d9cdb8', BRAND.green3]) });
    }
    box(svg, cam, pal, [-1.6, 0, 4], [1.6, 0.9, 5], { color: BRAND.stoneLight });
    box(svg, cam, pal, [-1.7, 0.9, 3.9], [1.7, 0.96, 5.1], { color: BRAND.green });
    box(svg, cam, pal, [-0.8, 0, 6.6], [0.8, 1.05, 7.4], { color: shade(pal.accent, 0.9) });
  } else {
    for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
      const x0 = -W + 1 + col * 3.4;
      const z0 = 2 + row * 2.6;
      table(ctx, x0, z0, x0 + 2.8, z0 + 1.4, 0.74, '#f1ece4', '#3a3a3a');
      for (let k = 0; k < 3; k++) {
        box(svg, cam, pal, [x0 + 0.3 + k * 0.9, 0.74, z0 + 0.6], [x0 + 0.8 + k * 0.9, 1.05, z0 + 0.63], { color: '#1f2523' });
        box(svg, cam, pal, [x0 + 0.35 + k * 0.9, 0, z0 - 0.5], [x0 + 0.8 + k * 0.9, 0.48, z0 - 0.05], { color: r.pick([pal.accent, BRAND.green2, '#57605a']) });
      }
    }
    // Glass meeting room on the right.
    box(svg, cam, pal, [W - 3.4, 0, 6], [W - 0.1, room.h, 6.05], { color: mix(pal.glassHi, '#ffffff', 0.4), opacity: 0.35 });
    table(ctx, W - 2.8, 7, W - 0.8, 8.6, 0.74, BRAND.stoneDark);
  }
  for (let x = -W + 1.5; x < W; x += 3) for (let z = 2; z < room.d - 1; z += 3) pendant(ctx, x, z, room.h, 0.6, 0.3);
  plant(ctx, r.fork('p1'), W - 0.6, 1.5, 1.6);
  plant(ctx, r.fork('p2'), -W + 0.6, room.d - 1, 1.4);
  finish(svg, pal, 0.3);
  return svg.toString();
}
