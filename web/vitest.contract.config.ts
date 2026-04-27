/**
 * Vitest config for contract tests only.
 *
 * Contract tests live under web/tests/contract/ and require a running
 * backend seeded by tools/qa/start-test-backend.mjs. They are NOT
 * included in the default vite dev/build cycle — zod stays test-only.
 *
 * Port is read at runtime from .test-backend-port (written by start script).
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/contract/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
