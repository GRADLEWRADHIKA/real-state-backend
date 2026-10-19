import type { Rng } from './rng.js';
import type { V3 } from './camera.js';

export type TimeOfDay = 'morning' | 'golden' | 'dusk';

/** Starwiz brand colours every scene is built from. */
export const BRAND = {
  green: '#062419',
  green2: '#0e3a2a',
  green3: '#1f5a43',
  stone: '#d8c9ae',
  stoneLight: '#efe6d6',
  stoneDark: '#a8957a',
  brass: '#b08d57',
  brassLight: '#d9bb84',
  ink: '#1d2a24',
  paper: '#f6f1e7',
};

export interface Palette {
  time: TimeOfDay;
  skyTop: string;
  skyMid: string;
  horizon: string;
  sun: string;
  haze: string;
  cloud: string;
  /** Direction light travels from (unit, pointing towards the sun). */
  sunDir: V3;
  /** 0..1 position of the sun across the frame. */
  sunX: number;
  ambient: number;
  lit: string;
  litRatio: number;
  glass: string;
  glassHi: string;
  grass: string;
  grassFar: string;
  foliage: string[];
  shadow: string;
  shadowOpacity: number;
  accent: string;
  /** Warm or cool tint multiplied over the whole frame. */
  grade: string;
  gradeOpacity: number;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function palette(r: Rng, time: TimeOfDay, accent: string): Palette {
  const side = r.chance(0.5) ? -1 : 1;
  const foliage = ['#2f5a3a', '#3d6b42', '#4f7b48', '#29503a', '#5f8a4e'];
  switch (time) {
    case 'morning':
      return {
        time, skyTop: '#6fa3cf', skyMid: '#b9d3e2', horizon: '#eef0e4', sun: '#fff6dc', haze: '#dfe7e3', cloud: '#ffffff',
        sunDir: norm([side * 0.6, 0.75, -0.45]), sunX: side < 0 ? 0.2 : 0.8, ambient: 0.62,
        lit: '#f6dca8', litRatio: 0.08, glass: '#7e9fb1', glassHi: '#d6e6ee', grass: '#5d8a4b', grassFar: '#a9bf96', foliage,
        shadow: '#203a42', shadowOpacity: 0.28, accent, grade: '#e8f0f0', gradeOpacity: 0.05,
      };
    case 'dusk':
      return {
        time, skyTop: '#1d2f4f', skyMid: '#5e6688', horizon: '#eaa57a', sun: '#ffc48a', haze: '#b49aa0', cloud: '#e9a58c',
        sunDir: norm([side * 0.85, 0.18, -0.5]), sunX: side < 0 ? 0.15 : 0.85, ambient: 0.48,
        lit: '#ffcf86', litRatio: 0.62, glass: '#3c4b66', glassHi: '#c99b86', grass: '#3d5c3c', grassFar: '#7d806f', foliage: foliage.map((f) => f),
        shadow: '#1a1d33', shadowOpacity: 0.32, accent, grade: '#4a3a66', gradeOpacity: 0.1,
      };
    default:
      return {
        time: 'golden', skyTop: '#5f93bd', skyMid: '#c3d3d4', horizon: '#f4d3a2', sun: '#ffe2ae', haze: '#ecd5b4', cloud: '#fff1dc',
        sunDir: norm([side * 0.75, 0.35, -0.55]), sunX: side < 0 ? 0.18 : 0.82, ambient: 0.55,
        lit: '#ffd59a', litRatio: 0.22, glass: '#6d8a9c', glassHi: '#f2d2a4', grass: '#5b8545', grassFar: '#b5b98d', foliage,
        shadow: '#2a2a3a', shadowOpacity: 0.3, accent, grade: '#ffb46b', gradeOpacity: 0.07,
      };
  }
}

export const ACCENTS = [BRAND.brass, '#b8674a', '#7d9a7e', '#3f6f6c', '#9a6f4e'];
