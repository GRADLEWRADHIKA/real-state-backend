/** Apartment: residential tower at golden hour (or the property's time of day) across a landscaped forecourt. */
import { camera, type V3 } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { facade, glassFills } from '../scene/facade.js';
import { box, boxMarkup, castShadow, finish, foregroundFoliage, ground, haze, quad, sky, skyline, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';
import { depth } from '../scene/camera.js';

export default function towerExterior(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const fl = 3.1;
  const H = 6 + s.storeys * fl;
  const W = 22 * s.proportion;
  const D = 16;
  const camX = r.range(-48, -36);
  const camZ = -80 - s.storeys * 1.2;
  // Two-point perspective with lens shift: verticals stay vertical, as in architectural photography.
  const cam = camera([camX, 1.7, camZ], { yaw: (Math.atan2(-camX + 4, -camZ + 8) * 180) / Math.PI, pitch: 0, fov: 58, w: s.width, h: s.height, cy: 0.74 });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'), { clouds: 6 });
  skyline(svg, cam, pal, r.fork('skyline'), { height: 0.08, lights: pal.time === 'dusk' });
  treeLine(svg, cam, pal, r.fork('treeline'));
  haze(svg, cam, pal, 0.45);
  ground(svg, cam, pal);

  const fills = glassFills(svg, pal);
  const litRatio = Math.min(0.9, pal.litRatio * (s.occupied ? 1.35 : 1));
  const towers: { x: number; z: number; w: number; d: number; storeys: number; subject: boolean }[] = [
    { x: 0, z: 0, w: W, d: D, storeys: s.storeys, subject: true },
    { x: 46 + r.range(0, 10), z: 38, w: W * 0.95, d: D, storeys: s.storeys - r.int(1, 3), subject: false },
  ];
  if (r.chance(0.6)) towers.push({ x: -58, z: 70, w: W * 0.9, d: D, storeys: s.storeys + r.int(0, 3), subject: false });

  // Forecourt paving, driveway and lawn edges.
  const paving = mix(BRAND.stoneLight, pal.haze, 0.15);
  quad(svg, cam, [[-38, 0.01, -30], [40, 0.01, -30], [40, 0.01, D + 12], [-38, 0.01, D + 12]], `fill="${shade(paving, 0.92)}"`, 3000);
  quad(svg, cam, [[-8, 0.02, -200], [8, 0.02, -200], [8, 0.02, -30], [-8, 0.02, -30]], `fill="${shade('#8c8a84', 0.9)}"`, 3000);
  for (let z = -190; z < -32; z += 6) quad(svg, cam, [[-0.15, 0.03, z], [0.15, 0.03, z], [0.15, 0.03, z + 3], [-0.15, 0.03, z + 3]], `fill="#efe8d8" opacity="0.8"`, 2000);
  // Low hedges framing the forecourt.
  box(svg, cam, pal, [-38, 0, -31], [-9, 0.9, -29.6], { color: shade(pal.foliage[1], 0.85) });
  box(svg, cam, pal, [9, 0, -31], [40, 0.9, -29.6], { color: shade(pal.foliage[1], 0.85) });

  for (const t of towers) {
    const h = 6 + t.storeys * fl;
    const min: V3 = [t.x - t.w / 2, 0, t.z];
    const max: V3 = [t.x + t.w / 2, h, t.z + t.d];
    castShadow(svg, cam, pal, min, max, 0, 0.8);
    const tr = r.fork(`tower${t.x}`);
    let m = boxMarkup(cam, pal, min, max, {
      color: BRAND.stoneLight,
      top: BRAND.stone,
      decorate: (f) =>
        facade(cam, pal, tr, f, fills, {
          floorH: fl, bays: Math.round((f.w / 3.6) * 1), glazing: 0.62, litRatio, slab: BRAND.stone, fin: s.pal.accent, finEvery: 3, from: 6,
          highlight: t.subject && s.property.floor ? Math.min(t.storeys - 1, s.property.floor - 1) : undefined,
        }),
    });
    // Glass podium lobby.
    m += boxMarkup(cam, pal, [min[0] + 1, 0, min[2] - 0.5], [max[0] - 1, 5.6, max[2]], {
      color: mix(pal.glass, BRAND.stone, 0.2),
      decorate: (f) => facade(cam, pal, tr, f, fills, { floorH: 5.6, bays: Math.round(f.w / 3), glazing: 0.9, litRatio: pal.time === 'dusk' ? 1 : 0.4, slab: BRAND.green2, curtain: true }),
    });
    // Balconies, drawn top-down so lower slabs overlap the ones above (camera looks up).
    const bays = Math.round(t.w / 3.6);
    const bw = t.w / bays;
    for (let k = t.storeys - 1; k >= 0; k--) {
      const y = 6 + k * fl;
      for (let b = 0; b < bays - 1; b++) {
        if ((b + k) % 2) continue;
        const x0 = min[0] + b * bw + 0.2;
        m += boxMarkup(cam, pal, [x0, y, min[2] - 1.5], [x0 + bw * 1.6, y + 0.22, min[2]], { color: BRAND.stoneLight });
        m += boxMarkup(cam, pal, [x0, y + 0.22, min[2] - 1.5], [x0 + bw * 1.6, y + 1.1, min[2] - 1.45], { color: mix(pal.glassHi, pal.glass, 0.4), opacity: 0.45 });
      }
    }
    // Rooftop crown.
    m += boxMarkup(cam, pal, [t.x - t.w * 0.2, h, t.z + 3], [t.x + t.w * 0.2, h + 4, t.z + t.d - 3], { color: BRAND.stone });
    m += boxMarkup(cam, pal, [min[0], h, min[2]], [max[0], h + 1.1, min[2] + 0.3], { color: s.pal.accent });
    svg.add(m, depth(cam, [t.x, h / 2, t.z + t.d / 2]));
  }
  // Entrance canopy.
  box(svg, cam, pal, [-6, 4.2, -9], [6, 4.6, -0.5], { color: BRAND.green, top: BRAND.green2 });
  for (const x of [-5.6, 5.2]) box(svg, cam, pal, [x, 0, -8.6], [x + 0.4, 4.2, -8.2], { color: s.pal.accent });

  // Planting: avenue trees, forecourt trees, palms by the entrance.
  const tr = r.fork('trees');
  for (let z = -150; z < -40; z += 12) {
    for (const x of [-13, 13]) tree(svg, cam, pal, tr, [x + tr.range(-1, 1), 0, z + tr.range(-2, 2)], tr.range(6, 9), 'round');
  }
  const n = Math.round(14 * s.treeDensity);
  for (let i = 0; i < n; i++) {
    // Keep the view of the tower clear: trees go to the sides and behind the forecourt hedge.
    const x = tr.chance(0.5) ? tr.range(-75, -26) : tr.range(24, 80);
    const z = tr.range(camZ + 45, 25);
    tree(svg, cam, pal, tr, [x, 0, z], tr.range(6, 11), tr.pick(['round', 'round', 'tall'] as const));
  }
  // Curved stone path through the lawn leads the eye to the entrance.
  const path: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const z = camZ + 6 + (i / 12) * (-30 - camZ - 6);
    path.push([camX * 0.55 * Math.cos((i / 12) * 1.4) - 2.2, 0.02, z]);
  }
  quad(svg, cam, [...path, ...path.slice().reverse().map(([x, y, z]) => [x + 4.4, y, z] as V3)], `fill="${shade(paving, 0.88)}"`, 2500);
  for (const x of [-9, 9]) tree(svg, cam, pal, tr, [x, 0, -18], 9, 'palm');
  for (let i = 0; i < 18; i++) tree(svg, cam, pal, tr, [tr.chance(0.5) ? tr.range(-36, -10) : tr.range(10, 38), 0, tr.range(-29, -24)], tr.range(1, 1.8), 'shrub');

  foregroundFoliage(svg, pal, r.fork('fg'), r.pick(['left', 'right', 'both'] as const), 1.1);
  finish(svg, pal);
  return svg.toString();
}
