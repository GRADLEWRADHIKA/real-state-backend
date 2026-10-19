/**
 * A tiny pinhole camera so scenes are composed in real 3D (metres) and get honest perspective,
 * occlusion order and face shading instead of flat clip-art shapes.
 * World axes: x right, y up, z forward. Yaw turns right, pitch > 0 looks down.
 */
export type V3 = [number, number, number];
export type P2 = [number, number];

export interface Camera {
  pos: V3;
  yaw: number;
  pitch: number;
  /** Focal length in pixels. */
  f: number;
  w: number;
  h: number;
  /** Principal point y (lens shift): keeps verticals straight while framing tall buildings. */
  cy: number;
}

export const deg = (d: number) => (d * Math.PI) / 180;

export function camera(pos: V3, opts: { yaw?: number; pitch?: number; fov?: number; w: number; h: number; cy?: number }): Camera {
  const fov = deg(opts.fov ?? 60);
  return { pos, yaw: deg(opts.yaw ?? 0), pitch: deg(opts.pitch ?? 0), f: opts.w / 2 / Math.tan(fov / 2), w: opts.w, h: opts.h, cy: opts.h * (opts.cy ?? 0.5) };
}

/** Camera-space coordinates (z = depth in front of the camera). */
export function toCam(c: Camera, p: V3): V3 {
  const dx = p[0] - c.pos[0];
  const dy = p[1] - c.pos[1];
  const dz = p[2] - c.pos[2];
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const x = dx * cy - dz * sy;
  const z1 = dx * sy + dz * cy;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  return [x, dy * cp + z1 * sp, -dy * sp + z1 * cp];
}

const NEAR = 0.15;

export function camToScreen(c: Camera, q: V3): P2 {
  return [c.w / 2 + (c.f * q[0]) / q[2], c.cy - (c.f * q[1]) / q[2]];
}

export function project(c: Camera, p: V3): (P2 & { depth?: number }) | null {
  const q = toCam(c, p);
  if (q[2] < NEAR) return null;
  return camToScreen(c, q);
}

/** Depth of a point (for painter's ordering). */
export const depth = (c: Camera, p: V3) => toCam(c, p)[2];

/** Screen-space scale of one metre at a world point. */
export const scaleAt = (c: Camera, p: V3) => c.f / Math.max(NEAR, toCam(c, p)[2]);

/** Projects a planar polygon, clipping it against the near plane. Returns null when fully behind. */
export function projectPoly(c: Camera, pts: V3[]): P2[] | null {
  const cam = pts.map((p) => toCam(c, p));
  const out: V3[] = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i];
    const b = cam[(i + 1) % cam.length];
    const ain = a[2] >= NEAR;
    const bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  if (out.length < 3) return null;
  return clip2d(out.map((q) => camToScreen(c, q)), -c.w, -c.h, 2 * c.w, 2 * c.h);
}

/** Clips a screen polygon to a generous frame so the rasteriser never sees huge coordinates. */
function clip2d(poly: P2[], x0: number, y0: number, x1: number, y1: number): P2[] | null {
  const edges: [(p: P2) => boolean, (a: P2, b: P2) => P2][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  let cur = poly;
  for (const [inside, cut] of edges) {
    const next: P2[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      if (inside(a)) next.push(a);
      if (inside(a) !== inside(b)) next.push(cut(a, b));
    }
    cur = next;
    if (cur.length < 3) return null;
  }
  return cur;
}

/** Screen y of the horizon line. */
export const horizonY = (c: Camera) => c.cy - c.f * Math.tan(c.pitch);

export const pts = (p: P2[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
