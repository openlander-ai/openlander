import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI entry — needs shebang for `npx openlander`
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    shims: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library entry — no shebang
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    dts: true,
    sourcemap: true,
    splitting: true,
    shims: false,
  },
]);
