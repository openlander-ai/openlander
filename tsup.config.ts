import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Read version from package.json — single source of truth
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

// Runtime modules — resolved at runtime, not bundled
const externals = ['postgres', 'nodemailer'];
const emitDeclarations = process.env.OPENLANDER_BUILD_DTS !== 'false';
const emitSourcemaps = process.env.OPENLANDER_BUILD_SOURCEMAP !== 'false';

export default defineConfig([
  // CLI entry — needs shebang for `npx openlander`
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    dts: emitDeclarations,
    sourcemap: emitSourcemaps,
    splitting: true,
    shims: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: externals,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
  // Library entry — no shebang
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    dts: emitDeclarations,
    sourcemap: emitSourcemaps,
    splitting: true,
    shims: false,
    external: externals,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
]);
