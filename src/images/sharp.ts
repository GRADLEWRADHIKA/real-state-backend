type Sharp = typeof import('sharp').default;
let cached: Sharp | null | undefined;

/** sharp is loaded lazily; when it is missing or broken, uploads fall back to serving the original file. */
export async function loadSharp(): Promise<Sharp | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await import('sharp')).default;
  } catch (err) {
    // Kept free of the logger/config so the generator CLI and scene previews run without server settings.
    console.warn(`[images] sharp could not be loaded, so images are stored without resizing: ${err instanceof Error ? err.message : String(err)}`);
    cached = null;
  }
  return cached;
}
