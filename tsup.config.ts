import { defineConfig } from 'tsup';
import { solidPlugin } from 'esbuild-plugin-solid';

const solid = solidPlugin({
  solid: {
    moduleName: '@opentui/solid',
    generate: 'universal',
  },
});

// Bun-only modules — resolved at runtime, not bundled
const bunExternals = ['bun:sqlite', 'bun:ffi', 'bun:jsc', '@opentui/solid', '@opentui/core'];

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
      js: '#!/usr/bin/env bun',
    },
    esbuildPlugins: [solid],
    external: bunExternals,
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
    esbuildPlugins: [solid],
    external: bunExternals,
  },
]);
