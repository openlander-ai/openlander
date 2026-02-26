import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Shim bun:sqlite → better-sqlite3 wrapper for Node.js/vitest
      'bun:sqlite': resolve(__dirname, 'test/__mocks__/bun-sqlite.ts'),
      // Redirect drizzle bun adapter → better-sqlite3 adapter
      'drizzle-orm/bun-sqlite': 'drizzle-orm/better-sqlite3',
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
