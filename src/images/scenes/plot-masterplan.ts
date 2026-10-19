/** Plot: aerial master plan with the plot grid, roads, green belts and the subject plot highlighted. */
import { camera, type V3 } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { box, finish, ground, haze, quad, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';

/** Sizes in metres from the plot's area (sq ft), with a 1:1.5 frontage-to-depth ratio. */
export function plotSize(areaSqft: number): [number, number] {
  const m2 = areaSqft * 0.0929;
  const w = Math.sqrt(m2 / 1.5);
  return [w, w * 1.5];
}

export default function plotMasterplan(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const [pw, pd] = plotSize(s.property.area_sqft);
  const cam = camera([r.range(-20, -8), 90, -70], { yaw: r.range(12, 22), pitch: 48, fov: 55, w: s.width, h: s.height });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'), { clouds: 3 });
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.02 });
  haze(svg, cam, pal, 0.5);
  ground(svg, cam, pal);
  const earth = mix('#c9ad84', pal.sun, 0.1);
  const tr = r.fork('t');
  const blockW = 9.5 * 6;
  for (let by = -2; by <= 3; by++)
    for (let bx = -3; bx <= 3; bx++) {
      const x0 = bx * (blockW + 12);
      const z0 = by * (pd * 2 + 12);
      const green = (bx + by + 9) % 4 === 0;
      // 40 ft roads between blocks.
      quad(svg, cam, [[x0 - 12, 0.01, z0 - 12], [x0 + blockW, 0.01, z0 - 12], [x0 + blockW, 0.01, z0], [x0 - 12, 0.01, z0]], `fill="#7a7871"`, 3000);
      quad(svg, cam, [[x0 - 12, 0.01, z0], [x0, 0.01, z0], [x0, 0.01, z0 + pd * 2], [x0 - 12, 0.01, z0 + pd * 2]], `fill="#7a7871"`, 3000);
      if (green) {
        quad(svg, cam, [[x0, 0.02, z0], [x0 + blockW, 0.02, z0], [x0 + blockW, 0.02, z0 + pd * 2], [x0, 0.02, z0 + pd * 2]], `fill="${mix(pal.grass, '#8fb36d', 0.4)}"`, 2900);
        quad(svg, cam, [[x0 + 6, 0.03, z0 + pd - 1], [x0 + blockW - 6, 0.03, z0 + pd - 1], [x0 + blockW - 6, 0.03, z0 + pd + 1], [x0 + 6, 0.03, z0 + pd + 1]], `fill="${BRAND.stoneLight}"`, 2850);
        for (let k = 0; k < Math.round(14 * s.treeDensity); k++) tree(svg, cam, pal, tr, [x0 + tr.range(2, blockW - 2), 0, z0 + tr.range(2, pd * 2 - 2)], tr.range(5, 9));
        continue;
      }
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < 6; i++) {
          const px = x0 + i * 9.5;
          const pz = z0 + row * pd;
          const subject = bx === 0 && by === 0 && row === 0 && i === 2;
          const built = !subject && tr.chance(0.25);
          const c: V3[] = [[px + 0.2, 0.02, pz + 0.2], [px + 9.3, 0.02, pz + 0.2], [px + 9.3, 0.02, pz + pd - 0.2], [px + 0.2, 0.02, pz + pd - 0.2]];
          quad(svg, cam, c, `fill="${subject ? mix(earth, BRAND.brassLight, 0.5) : built ? pal.grass : shade(earth, tr.range(0.92, 1.04))}" stroke="${subject ? BRAND.brass : '#ffffff'}" stroke-width="${subject ? 5 : 1}" stroke-opacity="${subject ? 1 : 0.6}"`, 2800);
          if (built) box(svg, cam, pal, [px + 1.5, 0, pz + 3], [px + 8, tr.chance(0.5) ? 6.5 : 3.4, pz + pd * 0.6], { color: BRAND.stoneLight, top: shade(BRAND.stone, 0.95) });
          if (subject) {
            for (const [x, z] of [[px + 0.4, pz + 0.4], [px + 9.1, pz + 0.4], [px + 0.4, pz + pd - 0.4], [px + 9.1, pz + pd - 0.4]]) box(svg, cam, pal, [x - 0.3, 0, z - 0.3], [x + 0.3, 1.2, z + 0.3], { color: BRAND.brass });
          }
        }
      for (let k = 0; k < 6; k++) tree(svg, cam, pal, tr, [x0 + k * 9.5 + 4, 0, z0 - 1.2], tr.range(4, 6));
    }
  finish(svg, pal, 0.3);
  return svg.toString();
}
