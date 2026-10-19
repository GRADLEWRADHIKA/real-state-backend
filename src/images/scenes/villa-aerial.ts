/** Villa: aerial view of the house footprint on its plot within the enclave grid. */
import { camera } from '../scene/camera.js';
import { mix, shade } from '../scene/color.js';
import { finish, ground, haze, quad, sky, tree, treeDefs, treeLine } from '../scene/kit.js';
import { BRAND } from '../scene/palette.js';
import type { Rng } from '../scene/rng.js';
import type { SceneSpec } from '../scene/spec.js';
import { Svg } from '../scene/svg.js';
import { pool, villa } from '../scene/villa.js';

export default function villaAerial(s: SceneSpec, r: Rng) {
  const { pal } = s;
  const svg = new Svg(s.width, s.height);
  const cam = camera([r.range(-30, -18), 48, -40], { yaw: r.range(25, 35), pitch: 38, fov: 55, w: s.width, h: s.height });
  treeDefs(svg, pal);
  sky(svg, cam, pal, r.fork('sky'), { clouds: 3 });
  treeLine(svg, cam, pal, r.fork('tl'), { height: 0.025 });
  haze(svg, cam, pal, 0.5);
  ground(svg, cam, pal);
  const road = shade('#7c7a74', 0.95);
  const PW = 20;
  const PD = 32;
  // Plot grid with roads between rows.
  for (let row = -2; row <= 4; row++) {
    const z0 = row * (PD + 9);
    quad(svg, cam, [[-200, 0.01, z0 - 9], [200, 0.01, z0 - 9], [200, 0.01, z0], [-200, 0.01, z0]], `fill="${road}"`, 3000);
  }
  const vr = r.fork('v');
  const tr = r.fork('t');
  for (let row = -1; row <= 3; row++)
    for (let col = -3; col <= 4; col++) {
      const x0 = col * (PW + 1);
      const z0 = row * (PD + 9);
      const subject = row === 0 && col === 0;
      quad(svg, cam, [[x0, 0.02, z0], [x0 + PW, 0.02, z0], [x0 + PW, 0.02, z0 + PD], [x0, 0.02, z0 + PD]], `fill="${subject ? mix(pal.grass, '#9fc27f', 0.4) : pal.grass}"${subject ? ` stroke="${BRAND.brassLight}" stroke-width="4"` : ` stroke="${shade(pal.grass, 0.8)}" stroke-width="1"`}`, 2800);
      if (vr.chance(subject ? 1 : 0.8)) {
        villa(svg, cam, pal, vr, { at: [x0 + 3, 0, z0 + 4], w: 14, d: 12, accent: subject ? s.pal.accent : BRAND.stoneDark, litRatio: pal.litRatio });
        if (subject || vr.chance(0.4)) pool(svg, cam, pal, vr, x0 + 4, z0 + 20, x0 + PW - 4, z0 + 25);
      }
      for (let k = 0; k < Math.round(3 * s.treeDensity); k++) tree(svg, cam, pal, tr, [x0 + tr.range(1, PW - 1), 0, z0 + tr.range(26, PD - 1)], tr.range(4, 7));
    }
  for (let x = -80; x < 100; x += 10) tree(svg, cam, pal, tr, [x, 0, -10], tr.range(5, 7));
  finish(svg, pal, 0.3);
  return svg.toString();
}
