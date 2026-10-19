/**
 * SceneSpec: everything a scene needs, derived from one property's own data plus a seed.
 * The same property + seed always produces the same specs (and so the same pixels).
 */
import { ACCENTS, type Palette, type TimeOfDay, palette } from './palette.js';
import { type Rng, rng } from './rng.js';

import { IMAGE_KINDS } from '@estateflow/shared';

export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ViewId =
  | 'tower-exterior'
  | 'lobby'
  | 'living-room'
  | 'bedroom'
  | 'kitchen'
  | 'pool-amenities'
  | 'floor-plan'
  | 'villa-front'
  | 'villa-backyard'
  | 'villa-aerial'
  | 'plot-masterplan'
  | 'plot-gate'
  | 'plot-street'
  | 'park'
  | 'amenities-map'
  | 'commercial-facade'
  | 'commercial-street'
  | 'office-interior';

export interface PropertyFacts {
  id: number;
  slug: string;
  name: string;
  type: string;
  project: string;
  city: string;
  location?: string | null;
  unit_number: string;
  tower?: string | null;
  floor?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqft: number;
  status: string;
  facing?: string | null;
  parking?: number | null;
  amenities: string[];
}

export interface Features {
  pool: boolean;
  gym: boolean;
  clubhouse: boolean;
  park: boolean;
  garden: boolean;
  kids: boolean;
  security: boolean;
  parking: boolean;
}

export interface SceneSpec {
  view: ViewId;
  kind: ImageKind;
  index: number;
  width: number;
  height: number;
  key: string;
  property: PropertyFacts;
  features: Features;
  time: TimeOfDay;
  pal: Palette;
  /** 0.5..1.5: how much planting a scene adds. */
  treeDensity: number;
  /** 0.85..1.15: stretches building proportions. */
  proportion: number;
  /** Storeys for towers / villas. */
  storeys: number;
  /** Lived-in look for booked or sold units (more lit windows). */
  occupied: boolean;
  alt: string;
  caption: string;
  /** Plain-language prompt for an optional local diffusion server. */
  prompt: string;
}

export type Category = 'apartment' | 'villa' | 'plot' | 'commercial';

export function categoryOf(type: string): Category {
  const t = type.toLowerCase();
  if (t === 'apartment') return 'apartment';
  if (t === 'villa') return 'villa';
  if (t === 'plot') return 'plot';
  return 'commercial';
}

const VIEWS: Record<Category, [ViewId, ImageKind, string][]> = {
  apartment: [
    ['tower-exterior', 'exterior', 'exterior view'],
    ['living-room', 'living', 'living room'],
    ['bedroom', 'bedroom', 'master bedroom'],
    ['kitchen', 'kitchen', 'modular kitchen'],
    ['lobby', 'lobby', 'entrance lobby'],
    ['pool-amenities', 'amenity', 'clubhouse and pool'],
    ['floor-plan', 'floor_plan', 'floor plan'],
  ],
  villa: [
    ['villa-front', 'exterior', 'front elevation'],
    ['living-room', 'living', 'double-height living room'],
    ['bedroom', 'bedroom', 'master bedroom'],
    ['kitchen', 'kitchen', 'kitchen and dining'],
    ['villa-backyard', 'amenity', 'backyard and pool'],
    ['villa-aerial', 'aerial', 'aerial view'],
    ['floor-plan', 'floor_plan', 'floor plan'],
  ],
  plot: [
    ['plot-masterplan', 'master_plan', 'aerial master plan'],
    ['plot-gate', 'exterior', 'entrance gate'],
    ['plot-street', 'street', 'internal road'],
    ['park', 'amenity', 'landscaped park'],
    ['amenities-map', 'master_plan', 'amenities map'],
  ],
  commercial: [
    ['commercial-facade', 'exterior', 'facade elevation'],
    ['commercial-street', 'street', 'street frontage'],
    ['lobby', 'lobby', 'entrance lobby'],
    ['office-interior', 'interior', 'interior'],
    ['floor-plan', 'floor_plan', 'floor plan'],
  ],
};

export function featuresOf(amenities: string[], cat: Category): Features {
  const a = amenities.join(' ').toLowerCase();
  return {
    pool: /pool/.test(a) || cat === 'villa',
    gym: /gym/.test(a),
    clubhouse: /club/.test(a),
    park: /park|landscap|green/.test(a) || cat === 'plot',
    garden: /garden/.test(a) || cat === 'villa',
    kids: /kid|play/.test(a),
    security: /secur|gated|cctv/.test(a),
    parking: /parking/.test(a) || cat !== 'plot',
  };
}

const article = (t: string) => (/^[aeiou]/i.test(t) ? 'an' : 'a');

/** Sizes: the first (hero) image is 16:9, the rest 4:3. */
export const HERO = { width: 1600, height: 900 };
export const GALLERY = { width: 1200, height: 900 };

export function buildSceneSpecs(p: PropertyFacts, seed = 1): SceneSpec[] {
  const cat = categoryOf(p.type);
  const base = rng(`${p.slug}#${p.id}#${seed}`);
  const time: TimeOfDay = base.pick(['golden', 'golden', 'morning', 'dusk'] as const);
  const accent = base.pick(ACCENTS);
  const treeDensity = base.range(0.7, 1.35);
  const proportion = base.range(0.88, 1.14);
  const storeys = cat === 'apartment' ? Math.max(12, (p.floor ?? 8) + base.int(3, 8)) : cat === 'villa' ? 2 : cat === 'commercial' ? base.int(3, 5) : 0;
  const features = featuresOf(p.amenities ?? [], cat);
  const occupied = ['Booked', 'Sold'].includes(p.status);
  const typeLabel = p.type.toLowerCase();
  return VIEWS[cat].map(([view, kind, label], index) => {
    const r: Rng = base.fork(view);
    // Interiors keep daylight; exteriors honour the property's time of day.
    const sceneTime: TimeOfDay = ['living-room', 'bedroom', 'kitchen', 'lobby', 'office-interior'].includes(view) ? (time === 'dusk' ? 'golden' : time) : time;
    const size = index === 0 ? HERO : GALLERY;
    const plan = kind === 'floor_plan' || kind === 'master_plan';
    return {
      view,
      kind,
      index,
      ...size,
      key: `${p.slug}#${p.id}#${seed}#${view}`,
      property: p,
      features,
      time: sceneTime,
      pal: palette(r, sceneTime, accent),
      treeDensity,
      proportion,
      storeys,
      occupied,
      alt: `Artist's impression: ${label} of ${p.name}, ${article(typeLabel)} ${typeLabel} in ${p.city}`,
      caption: plan ? `${label[0].toUpperCase()}${label.slice(1)} (illustrative, not to scale)` : `${label[0].toUpperCase()}${label.slice(1)} · artist's impression`,
      prompt: `architectural visualisation, ${label} of a ${p.bedrooms ? `${p.bedrooms} bedroom ` : ''}${typeLabel} in ${p.city}, India, ${p.project}, ${sceneTime === 'dusk' ? 'blue hour' : sceneTime === 'golden' ? 'golden hour' : 'soft morning light'}, warm stone and deep green palette, brass accents, photorealistic, no people, no text`,
    };
  });
}
