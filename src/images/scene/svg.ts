/** Collects defs and depth-sorted drawables, then serialises one SVG document. */
export class Svg {
  private defs: string[] = [];
  private items: { depth: number; order: number; s: string }[] = [];
  private n = 0;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  id(prefix: string) {
    return `${prefix}${++this.n}`;
  }

  def(markup: string) {
    this.defs.push(markup);
  }

  /** Vertical (default) or arbitrary linear gradient. stops: [offset 0..1, colour, opacity?]. */
  linear(stops: [number, string, number?][], x1 = 0, y1 = 0, x2 = 0, y2 = 1, units: 'objectBoundingBox' | 'userSpaceOnUse' = 'objectBoundingBox') {
    const id = this.id('lg');
    this.def(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="${units}">${stops
        .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`)
        .join('')}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  radial(stops: [number, string, number?][], cx = 0.5, cy = 0.5, r = 0.5, fx = cx, fy = cy, units: 'objectBoundingBox' | 'userSpaceOnUse' = 'objectBoundingBox') {
    const id = this.id('rg');
    this.def(
      `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}" gradientUnits="${units}">${stops
        .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`)
        .join('')}</radialGradient>`,
    );
    return `url(#${id})`;
  }

  blur(sd: number) {
    const id = this.id('bl');
    this.def(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
    return `url(#${id})`;
  }

  clip(markup: string) {
    const id = this.id('cp');
    this.def(`<clipPath id="${id}">${markup}</clipPath>`);
    return `url(#${id})`;
  }

  /** Larger depth is drawn first (further away). Equal depth keeps insertion order. */
  add(s: string, depth = 0) {
    this.items.push({ depth, order: this.items.length, s });
  }

  toString() {
    const body = [...this.items].sort((a, b) => b.depth - a.depth || a.order - b.order).map((i) => i.s);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}"><defs>${this.defs.join('')}</defs>${body.join('')}</svg>`;
  }
}

export const BACK = 1e9;
export const FRONT = -1e9;
