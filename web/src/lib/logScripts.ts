/**
 * Mock log scripts — drive the LogViewer prototype experience.
 *
 * Replace at backend wire-up time with a real `useDeployLogStream(deployId)`
 * hook backed by SSE/WebSocket. The shape per line is the contract.
 */

export type LogPhase =
  | 'clone'
  | 'image_pull'
  | 'build'
  | 'container_create'
  | 'container_start'
  | 'healthcheck_wait';

export type LogPrefix = 'info' | 'success' | 'warning' | 'error';

export interface LogProgressMeta {
  /** Display name, e.g. "node:20-alpine" */
  name: string;
  /** Total MB to download */
  total: number;
}

export interface LogEntry {
  phase: LogPhase;
  prefix: LogPrefix;
  /** Raw payload. Special markers:
   *  - `{step}#N` prefix for build-step header lines (extracted by renderer)
   *  - `{progress}` placeholder when `progress` meta is set (renderer animates a bar)
   *  - ANSI escape sequences for color (rendered by parseAnsi in LogViewer)
   */
  payload: string;
  /** When `payload === '{progress}'`, this carries the bar metadata */
  progress?: LogProgressMeta;
}

export const LOG_SCRIPT_BASE: LogEntry[] = [
  // CLONE
  {
    phase: 'clone',
    prefix: 'info',
    payload: "Cloning into '/var/openlander/hotdeal-tracker/code'...",
  },
  { phase: 'clone', prefix: 'info', payload: 'remote: Counting objects: 100% (1284/1284), done.' },
  { phase: 'clone', prefix: 'info', payload: 'remote: Compressing objects: 100% (618/618), done.' },
  {
    phase: 'clone',
    prefix: 'info',
    payload: 'remote: Total 1284 (delta 642), reused 1284 (delta 642)',
  },
  { phase: 'clone', prefix: 'info', payload: 'Resolving deltas: 100% (642/642), done.' },
  { phase: 'clone', prefix: 'success', payload: 'Cloned in 2.4s · HEAD at 7af3c12 · main' },

  // IMAGE PULL
  { phase: 'image_pull', prefix: 'info', payload: 'Pulling base images...' },
  {
    phase: 'image_pull',
    prefix: 'info',
    payload: '{progress}',
    progress: { name: 'node:20-alpine', total: 47.3 },
  },
  {
    phase: 'image_pull',
    prefix: 'info',
    payload: '{progress}',
    progress: { name: 'pgvector/pgvector:pg16', total: 312.0 },
  },
  {
    phase: 'image_pull',
    prefix: 'info',
    payload: '{progress}',
    progress: { name: 'redis:7-alpine', total: 22.7 },
  },
  { phase: 'image_pull', prefix: 'success', payload: 'All base images ready.' },

  // BUILD
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#1 [internal] load build definition from Dockerfile.web',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#1 DONE 0.0s' },
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#2 [internal] load metadata for docker.io/library/node:20-alpine',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#2 DONE 0.4s' },
  { phase: 'build', prefix: 'info', payload: '{step}#3 [base 1/4] FROM node:20-alpine' },
  { phase: 'build', prefix: 'info', payload: '{step}#3 CACHED' },
  { phase: 'build', prefix: 'info', payload: '{step}#4 [internal] load build context' },
  { phase: 'build', prefix: 'info', payload: '{step}#4 transferring context: 21.07MB' },
  { phase: 'build', prefix: 'success', payload: '{step}#4 DONE 0.9s' },
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#5 [build 1/3] COPY package.json pnpm-lock.yaml ./',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#5 DONE 0.1s' },
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#6 [build 2/3] RUN pnpm install --frozen-lockfile',
  },
  { phase: 'build', prefix: 'info', payload: 'resolved 1284 packages, fetched 1284 packages' },
  {
    phase: 'build',
    prefix: 'info',
    payload: 'Progress: resolved 1284, downloaded 0, added 1284, done',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#6 DONE 41.2s' },
  { phase: 'build', prefix: 'info', payload: '{step}#7 [build 3/3] RUN pnpm --filter web build' },
  { phase: 'build', prefix: 'info', payload: '[32m▲ Next.js 14.2.5[0m' },
  { phase: 'build', prefix: 'info', payload: ' [32m✓[0m Compiled successfully' },
  { phase: 'build', prefix: 'success', payload: '{step}#7 DONE 22.0s' },
  { phase: 'build', prefix: 'info', payload: '{step}#8 exporting to image' },
  { phase: 'build', prefix: 'success', payload: '{step}#8 DONE 5.1s' },

  // CONTAINER CREATE
  {
    phase: 'container_create',
    prefix: 'info',
    payload: 'Creating compose network ol-hotdeal-network',
  },
  { phase: 'container_create', prefix: 'info', payload: 'Creating container ol-hotdeal-postgres' },
  { phase: 'container_create', prefix: 'info', payload: 'Creating container ol-hotdeal-redis' },
  { phase: 'container_create', prefix: 'info', payload: 'Creating container ol-hotdeal-api' },
  { phase: 'container_create', prefix: 'info', payload: 'Creating container ol-hotdeal-worker' },
  { phase: 'container_create', prefix: 'info', payload: 'Creating container ol-hotdeal-web' },
  { phase: 'container_create', prefix: 'success', payload: 'All containers created.' },

  // CONTAINER START
  { phase: 'container_start', prefix: 'info', payload: 'Container ol-hotdeal-postgres Starting' },
  { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-postgres Started' },
  { phase: 'container_start', prefix: 'info', payload: 'Container ol-hotdeal-redis Starting' },
  { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-redis Started' },
  { phase: 'container_start', prefix: 'info', payload: 'Container ol-hotdeal-api Starting' },
  { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-api Started' },
  { phase: 'container_start', prefix: 'info', payload: 'Container ol-hotdeal-worker Starting' },
  { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-worker Started' },
  { phase: 'container_start', prefix: 'info', payload: 'Container ol-hotdeal-web Starting' },
  { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-web Started' },

  // HEALTHCHECK
  {
    phase: 'healthcheck_wait',
    prefix: 'info',
    payload: 'Container ol-hotdeal-postgres Waiting for health',
  },
  {
    phase: 'healthcheck_wait',
    prefix: 'success',
    payload: 'Container ol-hotdeal-postgres Healthy',
  },
  {
    phase: 'healthcheck_wait',
    prefix: 'info',
    payload: 'Container ol-hotdeal-api Waiting for health (start_period 30s)',
  },
  { phase: 'healthcheck_wait', prefix: 'info', payload: '[api] Running prisma migrations...' },
  {
    phase: 'healthcheck_wait',
    prefix: 'info',
    payload: '[api] Migration `20260418_add_vector_index` applied',
  },
  { phase: 'healthcheck_wait', prefix: 'info', payload: '[api] Server listening on :8000' },
  { phase: 'healthcheck_wait', prefix: 'success', payload: 'Container ol-hotdeal-api Healthy' },
  { phase: 'healthcheck_wait', prefix: 'success', payload: 'Container ol-hotdeal-worker Healthy' },
  { phase: 'healthcheck_wait', prefix: 'success', payload: 'Container ol-hotdeal-web Healthy' },
];

// FAIL variant pulls the entire CLONE phase from the BASE script and stops
// after a synthetic build failure. The phase filter is robust to BASE edits;
// the previous `slice(0, 6)` magic-number broke when CLONE entries changed.
const CLONE_FIXTURE: LogEntry[] = LOG_SCRIPT_BASE.filter((e) => e.phase === 'clone');

export const LOG_SCRIPT_FAIL: LogEntry[] = [
  ...CLONE_FIXTURE,
  { phase: 'image_pull', prefix: 'info', payload: 'All base images cached.' },
  // BUILD up to failure
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#1 [internal] load build definition from Dockerfile.web',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#1 DONE 0.0s' },
  {
    phase: 'build',
    prefix: 'info',
    payload: '{step}#2 [internal] load metadata for docker.io/library/node:20-alpine',
  },
  { phase: 'build', prefix: 'success', payload: '{step}#2 DONE 0.4s' },
  { phase: 'build', prefix: 'info', payload: '{step}#3 [base 1/4] FROM node:20-alpine' },
  { phase: 'build', prefix: 'info', payload: '{step}#3 CACHED' },
  { phase: 'build', prefix: 'info', payload: '{step}#4 [internal] load build context' },
  { phase: 'build', prefix: 'info', payload: '{step}#4 transferring context: 21.07MB' },
  { phase: 'build', prefix: 'success', payload: '{step}#4 DONE 0.9s' },
  { phase: 'build', prefix: 'info', payload: '{step}#5 [build 1/3] COPY apps/web/ ./apps/web' },
  {
    phase: 'build',
    prefix: 'error',
    payload: '{step}#5 ERROR: failed to calculate checksum of ref ...: "/apps/web": not found',
  },
  { phase: 'build', prefix: 'error', payload: '------' },
  { phase: 'build', prefix: 'error', payload: ' > [build 1/3] COPY apps/web/ ./apps/web:' },
  { phase: 'build', prefix: 'error', payload: '------' },
  { phase: 'build', prefix: 'error', payload: 'Dockerfile.web:14' },
  { phase: 'build', prefix: 'error', payload: '  12 |  WORKDIR /app' },
  { phase: 'build', prefix: 'error', payload: '  13 |  COPY package.json pnpm-lock.yaml ./' },
  { phase: 'build', prefix: 'error', payload: '  14 | >>> COPY apps/web/ ./apps/web' },
  {
    phase: 'build',
    prefix: 'error',
    payload: 'ERROR: target web: failed to solve: "/apps/web": not found',
  },
];

/**
 * Synthesise a long log to exercise the virtualizer (5k–20k lines). The
 * generator inflates the BUILD phase with realistic-looking pnpm output;
 * the rest of the phases stay short.
 */
export function buildLargeScript(targetLines: number): LogEntry[] {
  const out: LogEntry[] = [];

  out.push(
    {
      phase: 'clone',
      prefix: 'info',
      payload: "Cloning into '/var/openlander/hotdeal-tracker/code'...",
    },
    { phase: 'clone', prefix: 'info', payload: 'Resolving deltas: 100% (618/618), done.' },
    { phase: 'clone', prefix: 'success', payload: 'Cloned in 2.4s' },
    { phase: 'image_pull', prefix: 'success', payload: 'All base images cached.' },
    {
      phase: 'build',
      prefix: 'info',
      payload: '{step}#1 [internal] load build definition from Dockerfile.web',
    },
    { phase: 'build', prefix: 'success', payload: '{step}#1 DONE 0.0s' },
    {
      phase: 'build',
      prefix: 'info',
      payload: '{step}#7 [deps 1/1] RUN pnpm install --frozen-lockfile',
    },
  );

  const adjectives = ['resolved', 'fetched', 'linked', 'deduped', 'pruned'];
  const pkgs = [
    '@radix-ui/react-dialog',
    'next',
    'react',
    'react-dom',
    'lucide-react',
    'zod',
    'tailwindcss',
    'postcss',
    'autoprefixer',
    '@prisma/client',
    'prisma',
    'drizzle-orm',
    'esbuild',
    'vite',
    'vitest',
    'playwright',
    '@types/node',
    '@types/react',
    'typescript',
    'eslint',
    'prettier',
    '@vercel/analytics',
    'framer-motion',
    'swr',
    'axios',
    'zustand',
    'lodash-es',
    'date-fns',
    'uuid',
    '@sentry/nextjs',
    'next-auth',
    'iron-session',
    'argon2',
    'jose',
    'ws',
    'redis',
    'ioredis',
    '@aws-sdk/client-s3',
    'sharp',
    'graphql',
    '@apollo/client',
    'react-query',
    'react-hook-form',
    'yup',
    '@radix-ui/react-popover',
    '@radix-ui/react-select',
    '@radix-ui/react-tooltip',
    'cmdk',
    'vaul',
    'sonner',
    'react-day-picker',
    '@hookform/resolvers',
  ];
  const versions = ['1.2.3', '0.4.18', '2.0.1', '5.7.4', '18.3.1', '14.2.5', '1.7.2'];

  let i = 0;
  while (out.length < targetLines - 30) {
    const adj = adjectives[i % adjectives.length];
    const pkg = pkgs[i % pkgs.length];
    const ver = versions[i % versions.length];
    out.push({ phase: 'build', prefix: 'info', payload: `${adj} ${pkg}@${ver}` });
    i++;
    if (i % 80 === 0) {
      out.push({
        phase: 'build',
        prefix: 'warning',
        payload: ` WARN  deprecated subdependency [33msemver@5.7.1[0m via ${pkg}`,
      });
    }
    if (i % 200 === 0) {
      out.push({
        phase: 'build',
        prefix: 'info',
        payload: `Progress: resolved ${i}, reused ${i}, downloaded 0, added ${i}, done`,
      });
    }
  }
  out.push(
    { phase: 'build', prefix: 'success', payload: '{step}#7 DONE 41.2s' },
    { phase: 'build', prefix: 'info', payload: '{step}#8 [build 1/3] COPY apps/web ./apps/web' },
    { phase: 'build', prefix: 'success', payload: '{step}#8 DONE 0.3s' },
    { phase: 'build', prefix: 'info', payload: '{step}#9 [build 2/3] RUN pnpm --filter web build' },
    { phase: 'build', prefix: 'info', payload: '[32m▲ Next.js 14.2.5[0m' },
    { phase: 'build', prefix: 'info', payload: ' [32m✓[0m Compiled successfully' },
    { phase: 'build', prefix: 'success', payload: '{step}#9 DONE 22.0s' },
    { phase: 'build', prefix: 'info', payload: '{step}#12 exporting to image' },
    { phase: 'build', prefix: 'success', payload: '{step}#12 DONE 5.1s' },
    { phase: 'container_start', prefix: 'success', payload: 'Container ol-hotdeal-web Started' },
    { phase: 'healthcheck_wait', prefix: 'success', payload: 'Container ol-hotdeal-web Healthy' },
  );
  return out;
}
