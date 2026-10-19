/**
 * Procedural renderer: SceneSpec → SVG → raster (sharp) with film grain → WebP.
 * No browser, no network; output depends only on the spec.
 */
import type { SceneSpec } from './scene/spec.js';
import { rng } from './scene/rng.js';
import { SCENES } from './scenes/index.js';
import { loadSharp } from './sharp.js';

export function renderSvg(spec: SceneSpec): string {
  const scene = SCENES[spec.view];
  if (!scene) throw new Error(`No scene for view ${spec.view}`);
  return scene(spec, rng(spec.key));
}

function grain(spec: SceneSpec, amount: number) {
  const r = rng(`${spec.key}#grain`);
  // Grain at half resolution, upscaled: film-like and far kinder to WebP than per-pixel noise.
  const w = Math.ceil(spec.width / 2);
  const h = Math.ceil(spec.height / 2);
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 128 + Math.round((r.next() - 0.5) * 255 * amount);
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return { buf, w, h };
}

export async function renderWebp(spec: SceneSpec, quality = 80): Promise<Buffer> {
  const sharp = await loadSharp();
  if (!sharp) throw new Error('The procedural generator needs the sharp package (npm install -w server sharp).');
  const svg = renderSvg(spec);
  const base = await sharp(Buffer.from(svg), { density: 72 }).resize(spec.width, spec.height).removeAlpha().png().toBuffer();
  const g = grain(spec, 0.16);
  const noise = await sharp(g.buf, { raw: { width: g.w, height: g.h, channels: 4 } }).resize(spec.width, spec.height, { kernel: 'cubic' }).png().toBuffer();
  return sharp(base).composite([{ input: noise, blend: 'soft-light' }]).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
}
