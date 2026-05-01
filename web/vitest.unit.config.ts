/**
 * Vitest config for unit tests (no backend required).
 *
 * Covers src/**\/__tests__\/*.test.ts and web/test/**\/*.test.ts.
 * Environment: node (no DOM — testing-library not installed).
 * For contract tests (require live backend) use vitest.contract.config.ts.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
    ],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
