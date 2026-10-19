type RGB = [number, number, number];

const clamp = (v: number, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));

export function rgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('')}`;

/** Linear blend from a (t = 0) to b (t = 1). */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** k < 1 darkens, k > 1 lightens (towards white). */
export function shade(c: string, k: number) {
  return k <= 1 ? mix('#000000', c, k) : mix(c, '#ffffff', Math.min(1, k - 1));
}
