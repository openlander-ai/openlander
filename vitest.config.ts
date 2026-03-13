import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'web/src/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web/src'),
      'lucide-react': path.resolve(__dirname, 'test/mocks/lucide-react.ts'),
    },
  },
});
