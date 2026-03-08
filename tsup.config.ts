import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { solidPlugin } from 'esbuild-plugin-solid';

// Read version from package.json — single source of truth
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };
const solid = solidPlugin({
  solid: {
    moduleName: '@opentui/solid',
    generate: 'universal',
  },
});

// Runtime modules — resolved at runtime, not bundled
const externals = ['better-sqlite3', '@opentui/solid', 'solid-js'];

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
    esbuildPlugins: [solid],
    external: externals,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
    external: externals,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
]);
