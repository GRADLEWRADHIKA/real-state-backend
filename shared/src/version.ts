/** Product version shared by the API (/api/meta), the dashboard and the app. Bump on every release. */
export const APP_VERSION = '2.0.0';
export const APP_NAME = 'EstateFlow CRM';

/** -1 / 0 / 1 for dotted numeric versions ("2.0.10" > "2.0.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
