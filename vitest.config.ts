import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Each file gets its own throwaway demo database (see setup-env.ts).
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
