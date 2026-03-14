import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'web/src/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 55,
        functions: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web/src'),
      'lucide-react': path.resolve(__dirname, 'test/mocks/lucide-react.ts'),
    },
  },
});
