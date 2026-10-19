/**
 * Property image generation. Providers:
 *  - procedural (default): offline SVG scenes rendered by sharp, deterministic per property + seed.
 *  - folder: imports files dropped into design/ai-images/<slug>/.
 *  - local-diffusion: a Stable Diffusion server on this machine (AUTOMATIC1111 or ComfyUI). No keys, no cloud.
 * Every provider writes design/ai-images/<slug>/NN-<kind>.webp and imports through the upload pipeline,
 * replacing only images with source = 'generated'. Staff uploads are never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { addImage, deleteImages, ensureCover } from './store.js';
import { renderWebp } from './render.js';
import { buildSceneSpecs, type PropertyFacts, type SceneSpec } from './scene/spec.js';

export type Provider = 'procedural' | 'folder' | 'local-diffusion';
export const GENERATOR_VERSION = 1;

export const designDir = () => path.resolve(process.env.IMAGES_DESIGN_DIR || path.resolve(import.meta.dirname, '../../design/ai-images'));

export interface GenerateOptions {
  seed?: number;
  force?: boolean;
  provider?: Provider;
  sdUrl?: string;
  /** Treat folder imports as real photos (is_ai_generated = false). */
  photos?: boolean;
  log?: (msg: string) => void;
}

export async function propertyFacts(id: number): Promise<PropertyFacts | null> {
  const p = await db.get('SELECT * FROM properties WHERE id = ?', [id]);
  if (!p) return null;
  return { ...p, amenities: p.amenities ? JSON.parse(p.amenities) : [] };
}

const fileName = (s: SceneSpec) => `${String(s.index + 1).padStart(2, '0')}-${s.kind}.webp`;

/** Runs `fn` over items with limited parallelism (sharp renders on its own threads). */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function procedural(p: PropertyFacts, specs: SceneSpec[], dir: string, o: GenerateOptions) {
  const manifestFile = path.join(dir, 'manifest.json');
  const want = { generator: GENERATOR_VERSION, seed: o.seed ?? 1, id: p.id, views: specs.map(fileName) };
  let cached = false;
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    cached = !o.force && JSON.stringify(m) === JSON.stringify(want) && want.views.every((f) => fs.existsSync(path.join(dir, f)));
  } catch {
    /* no manifest yet */
  }
  if (!cached) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^\d\d-.*\.webp$/.test(f)) fs.rmSync(path.join(dir, f));
    await pool(specs, 3, async (s) => fs.writeFileSync(path.join(dir, fileName(s)), await renderWebp(s)));
    fs.writeFileSync(manifestFile, JSON.stringify(want, null, 2) + '\n');
  }
  return specs.map((s) => ({ file: path.join(dir, fileName(s)), spec: s }));
}

async function localDiffusion(specs: SceneSpec[], dir: string, o: GenerateOptions) {
  const url = (o.sdUrl || 'http://127.0.0.1:7860').replace(/\/+$/, '');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url + '/')) {
    throw new Error(`--sd-url must point at a Stable Diffusion server on this machine or your LAN, not ${url}`);
  }
  const ping = await fetch(`${url}/sdapi/v1/sd-models`).catch(() => null);
  const comfy = ping?.ok ? null : await fetch(`${url}/system_stats`).catch(() => null);
  if (!ping?.ok && !comfy?.ok) {
    throw new Error(`No Stable Diffusion server answered at ${url}. Start AUTOMATIC1111 with --api (or ComfyUI), or pass --sd-url.`);
  }
  const negative = 'text, watermark, logo, signage text, people, person, blurry, distorted, low quality';
  fs.mkdirSync(dir, { recursive: true });
  const { loadSharp } = await import('./sharp.js');
  const sharp = (await loadSharp())!;
  const out = [];
  for (const s of specs) {
    const w = Math.round(s.width / 2 / 8) * 8;
    const h = Math.round(s.height / 2 / 8) * 8;
    let png: Buffer;
    if (ping?.ok) {
      const r = await fetch(`${url}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: s.prompt, negative_prompt: negative, width: w, height: h, steps: 28, cfg_scale: 6.5, seed: s.index + (o.seed ?? 1) * 100 }) });
      if (!r.ok) throw new Error(`Stable Diffusion returned ${r.status}`);
      png = Buffer.from(((await r.json()) as { images: string[] }).images[0], 'base64');
    } else {
      png = await comfyRender(url, s.prompt, negative, w, h, s.index + (o.seed ?? 1) * 100);
    }
    const file = path.join(dir, fileName(s));
    fs.writeFileSync(file, await sharp(png).resize(s.width, s.height, { fit: 'cover' }).webp({ quality: 82 }).toBuffer());
    out.push({ file, spec: s });
    o.log?.(`  ${fileName(s)}`);
  }
  return out;
}

/** Minimal ComfyUI txt2img graph using the first installed checkpoint. */
async function comfyRender(url: string, prompt: string, negative: string, w: number, h: number, seed: number): Promise<Buffer> {
  const info = (await (await fetch(`${url}/object_info/CheckpointLoaderSimple`)).json()) as any;
  const ckpt = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0];
  if (!ckpt) throw new Error('ComfyUI has no checkpoint installed');
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps: 28, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'estateflow' } },
  };
  const { prompt_id } = (await (await fetch(`${url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph }) })).json()) as any;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hist = (await (await fetch(`${url}/history/${prompt_id}`)).json()) as any;
    const img = hist?.[prompt_id]?.outputs?.['7']?.images?.[0];
    if (img) return Buffer.from(await (await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer());
  }
  throw new Error('ComfyUI did not finish within 10 minutes');
}

function folderFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(webp|jpe?g|png)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

const KIND_FROM_NAME = /^\d+-([a-z_]+)/;

/**
 * Generates (or imports) images for one property. Without `force`, a property that already has
 * generated images is left alone, so repeated runs are cheap and idempotent.
 */
export async function generateForProperty(id: number, o: GenerateOptions = {}) {
  const p = await propertyFacts(id);
  if (!p) throw new Error(`Property ${id} not found`);
  const provider = o.provider ?? 'procedural';
  const existing = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM property_images WHERE property_id = ? AND source = 'generated'", [id]))!.n;
  if (existing && !o.force) return { property: p.slug, imported: 0, skipped: true };
  const dir = path.join(designDir(), p.slug);
  const specs = buildSceneSpecs(p, o.seed ?? 1);
  let files: { file: string; spec?: SceneSpec }[];
  if (provider === 'folder') files = folderFiles(dir).map((file) => ({ file }));
  else if (provider === 'local-diffusion') files = await localDiffusion(specs, dir, o);
  else files = await procedural(p, specs, dir, o);
  if (!files.length) return { property: p.slug, imported: 0, skipped: true };

  // Uploaded covers win; otherwise the first generated image (the hero) becomes the cover.
  const uploadedCover = await db.get("SELECT id FROM property_images WHERE property_id = ? AND source = 'upload' AND is_cover = 1", [id]);
  await deleteImages(id, "source = 'generated'");
  let i = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.file);
    const kind = f.spec?.kind ?? KIND_FROM_NAME.exec(path.basename(f.file))?.[1] ?? 'other';
    const label = kind.replace('_', ' ');
    await addImage(id, {
      buffer: buf,
      mime: /\.png$/i.test(f.file) ? 'image/png' : /\.jpe?g$/i.test(f.file) ? 'image/jpeg' : 'image/webp',
      alt_text: f.spec?.alt ?? `${o.photos ? 'Photo' : "Artist's impression"}: ${label} of ${p.name}, ${p.type.toLowerCase()} in ${p.city}`,
      caption: f.spec?.caption ?? null,
      kind,
      is_ai_generated: !o.photos,
      source: 'generated',
      cover: !uploadedCover && i === 0,
    });
    i++;
  }
  await ensureCover(id);
  return { property: p.slug, imported: files.length, skipped: false };
}

/** Background job used by the API (new property, "Generate images" button) and demo start-up. */
const running = new Set<number>();
export function generateInBackground(ids: number[], o: GenerateOptions & { onDone?: (id: number) => void } = {}) {
  const todo = ids.filter((id) => !running.has(id));
  todo.forEach((id) => running.add(id));
  return (async () => {
    for (const id of todo) {
      try {
        const r = await generateForProperty(id, o);
        if (!r.skipped) o.log?.(`generated ${r.imported} images for ${r.property}`);
        o.onDone?.(id);
      } catch (err) {
        o.log?.(`image generation failed for property ${id}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        running.delete(id);
      }
    }
  })();
}
export const isGenerating = (id: number) => running.has(id);
