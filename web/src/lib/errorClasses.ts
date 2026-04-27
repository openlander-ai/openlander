/**
 * Error class registry — drives FailureSummary / ErrorSurface.
 *
 * 1.0 ships SIXTEEN classes. Names are canonical and MUST match the
 * backend's `src/pipeline/error-classifier.ts` ErrorClass union exactly.
 * Phase F's vitest+zod contract test pins the two surfaces into agreement.
 *
 *   v1.0 (§§2.1–2.10):  CONFIG_MISSING, GIT_ACCESS_DENIED, BUILD_CONTEXT_MISMATCH,
 *                        IMAGE_WRONG_STAGE, DEPENDENCY_UNHEALTHY, DB_EXTENSION_MISSING,
 *                        PORT_CONFLICT, CLI_OVERRIDE_SYNTAX, RUNTIME_CRASH, INFRA_UNAVAILABLE
 *   v1.1 (§§2.12–2.16): OOM_KILLED, DOCKER_DAEMON_UNREACHABLE, DISK_EXHAUSTED,
 *                        NETWORK_DEPENDENCY_UNREACHABLE, HEALTHCHECK_TIMEOUT, BUILD_TIMEOUT
 *
 * Phase E_NEW (Architect iteration-4 blocker): registry expanded from 10
 * → 16 to match the v4 ErrorSurface narrative-specific copy. Source of
 * the per-key data: `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`
 * (ported verbatim — title/phase/step/target/fixHint/codeRefs).
 *
 * Renames from earlier rounds (the prototype had drift): R2's
 * PORT_COLLISION → PORT_CONFLICT, REGISTRY_UNREACHABLE →
 * NETWORK_DEPENDENCY_UNREACHABLE, HEALTHCHECK_FLAPPING →
 * HEALTHCHECK_TIMEOUT, DISK_FULL → DISK_EXHAUSTED, ENV_MISSING →
 * CONFIG_MISSING.
 *
 * The shape carries instance facts (phase, step, target, codeRefs) for
 * the prototype. The eventual backend-supplied incident payload will
 * replace these per-incident fields; the title and fix-hint stay as
 * static class metadata. We don't bother splitting today (PR4 work).
 */

export type ErrorClass =
  | 'CONFIG_MISSING'
  | 'GIT_ACCESS_DENIED'
  | 'BUILD_CONTEXT_MISMATCH'
  | 'IMAGE_WRONG_STAGE'
  | 'DEPENDENCY_UNHEALTHY'
  | 'DB_EXTENSION_MISSING'
  | 'PORT_CONFLICT'
  | 'CLI_OVERRIDE_SYNTAX'
  | 'RUNTIME_CRASH'
  | 'INFRA_UNAVAILABLE'
  | 'OOM_KILLED'
  | 'DOCKER_DAEMON_UNREACHABLE'
  | 'DISK_EXHAUSTED'
  | 'NETWORK_DEPENDENCY_UNREACHABLE'
  | 'HEALTHCHECK_TIMEOUT'
  | 'BUILD_TIMEOUT';

export type DeployPhase =
  | 'clone'
  | 'image_pull'
  | 'build'
  | 'container_create'
  | 'container_start'
  | 'healthcheck_wait'
  | '—';

export interface ErrorClassCodeRef {
  path: string;
  line: number | null;
  snippet: string;
}

export interface ErrorClassDef {
  /** Canonical key — matches backend taxonomy */
  id: ErrorClass;
  title: string;
  phase: DeployPhase;
  /** Display step like "5/12" or "—" */
  step: string;
  /** Affected target — service name, image name, "host", etc. */
  target: string;
  /**
   * Single-paragraph fix hint. Markdown-style backticks render as code
   * tokens by FailureSummary.
   */
  fixHint: string;
  codeRefs: ErrorClassCodeRef[];
}

export const ERROR_CLASSES: Record<ErrorClass, ErrorClassDef> = {
  CONFIG_MISSING: {
    id: 'CONFIG_MISSING',
    title: 'Build crashed because `DATABASE_URL` is not set',
    phase: 'build',
    step: '8/12',
    target: 'service "api"',
    fixHint:
      'Prisma generate runs at build time and reads `DATABASE_URL`. Mark it as a `build.args` in compose, or move the `prisma generate` call into the runtime entrypoint.',
    codeRefs: [{ path: 'Dockerfile.api', line: 14, snippet: 'RUN pnpm prisma generate' }],
  },
  GIT_ACCESS_DENIED: {
    id: 'GIT_ACCESS_DENIED',
    title: 'Cannot access repository — authentication failed',
    phase: 'clone',
    step: '—',
    target: 'github.com/jiho/hotdeal-tracker',
    fixHint:
      'The deploy key for this repo was rotated 4 days ago. Re-authorize the GitHub provider in `Settings → Git Providers`, or paste a new SSH key.',
    codeRefs: [{ path: '.openlander/source.yml', line: 3, snippet: 'provider: github' }],
  },
  BUILD_CONTEXT_MISMATCH: {
    id: 'BUILD_CONTEXT_MISMATCH',
    title: "Dockerfile expects a path that isn't in the build context",
    phase: 'build',
    step: '5/12',
    target: 'service "web"',
    fixHint:
      'Set `build.context: .` with explicit `dockerfile: Dockerfile.web` in `compose.yml`. Your context is currently `./apps/web`, which strips the `apps/` prefix from `COPY` targets.',
    codeRefs: [
      { path: 'compose.yml', line: 12, snippet: 'context: ./apps/web' },
      { path: 'Dockerfile.web', line: 8, snippet: 'COPY apps/web ./apps/web' },
    ],
  },
  IMAGE_WRONG_STAGE: {
    id: 'IMAGE_WRONG_STAGE',
    title: 'Multi-stage Dockerfile built the wrong target',
    phase: 'build',
    step: '9/12',
    target: 'service "api"',
    fixHint:
      'Your Dockerfile has 3 stages (`base`, `builder`, `api`). You set `target: builder` instead of `target: api` — the resulting image is missing the prod entrypoint.',
    codeRefs: [{ path: 'compose.yml', line: 22, snippet: 'target: builder' }],
  },
  DEPENDENCY_UNHEALTHY: {
    id: 'DEPENDENCY_UNHEALTHY',
    title: '`api` failed to start — its dependency `postgres` never became healthy',
    phase: 'healthcheck_wait',
    step: '—',
    target: 'service "api"',
    fixHint:
      '`postgres` is up but `pg_isready` is timing out at 30s (default). Increase its `healthcheck.start_period` to 60s, or check the postgres logs for slow init (e.g. extension build, large WAL replay).',
    codeRefs: [
      {
        path: 'compose.yml',
        line: 38,
        snippet: 'depends_on: { postgres: { condition: service_healthy } }',
      },
      {
        path: 'postgres logs',
        line: null,
        snippet: 'FATAL: extension "pgvector" creating index...',
      },
    ],
  },
  DB_EXTENSION_MISSING: {
    id: 'DB_EXTENSION_MISSING',
    title: '`postgres` migration failed — extension `vector` not available',
    phase: 'container_start',
    step: '—',
    target: 'service "postgres"',
    fixHint:
      'Your migration runs `CREATE EXTENSION vector` but the base image `postgres:16-alpine` does not ship it. Switch to `pgvector/pgvector:pg16` and re-deploy.',
    codeRefs: [
      { path: 'compose.yml', line: 51, snippet: 'image: postgres:16-alpine' },
      { path: 'migrations/0001_init.sql', line: 1, snippet: 'CREATE EXTENSION vector;' },
    ],
  },
  PORT_CONFLICT: {
    id: 'PORT_CONFLICT',
    title: 'Port 3000 is already bound on the host',
    phase: 'container_start',
    step: '—',
    target: 'service "web"',
    fixHint:
      'Another container (`legacy-web`) is already publishing :3000. Either stop the legacy stack or change `web` to expose internally only — the reverse proxy doesn’t need a host port.',
    codeRefs: [{ path: 'compose.yml', line: 9, snippet: 'ports: ["3000:3000"]' }],
  },
  CLI_OVERRIDE_SYNTAX: {
    id: 'CLI_OVERRIDE_SYNTAX',
    title: 'Custom deploy command failed to parse',
    phase: 'build',
    step: '—',
    target: 'service "web"',
    fixHint:
      'Your custom command starts with `docker` — but OpenLander auto-prepends `docker` itself, producing `docker docker compose -p ...`. Remove the leading `docker` from the override, or clear it to use the default.',
    codeRefs: [
      {
        path: 'Settings → Build → Custom command',
        line: null,
        snippet: 'docker compose -p hotdeal up -d',
      },
    ],
  },
  RUNTIME_CRASH: {
    id: 'RUNTIME_CRASH',
    title: '`worker` has crashed 12× in the last 24 hours',
    phase: 'container_start',
    step: '—',
    target: 'service "worker"',
    fixHint:
      'Most recent exit was code 1 with `unhandled SIGTERM during ingestion batch`. Auto-restart is on but the loop is degrading throughput. Open runtime logs to see the stack.',
    codeRefs: [
      {
        path: 'worker logs',
        line: null,
        snippet: 'FATAL unhandled rejection in fetchDeals()',
      },
    ],
  },
  INFRA_UNAVAILABLE: {
    id: 'INFRA_UNAVAILABLE',
    title: 'OpenLander agent is unreachable',
    phase: '—',
    step: '—',
    target: 'host',
    fixHint:
      'The console can’t reach the OpenLander agent on this host (3 retries × 30s). The agent service may be down — check `Web Server → Status` or restart it via SSH.',
    codeRefs: [],
  },
  OOM_KILLED: {
    id: 'OOM_KILLED',
    title: '`worker` was killed by the kernel — exceeded its 256MB memory limit',
    phase: 'container_start',
    step: '—',
    target: 'service "worker"',
    fixHint:
      'Worker peaked at 312MB during ingestion. Either raise `deploy.resources.limits.memory` to 512M or split the batch into smaller pages (current chunk = 5000 deals).',
    codeRefs: [
      { path: 'compose.yml', line: 67, snippet: 'memory: 256M' },
      { path: 'worker logs', line: null, snippet: 'Killed (OOM, peak 312MB)' },
    ],
  },
  DOCKER_DAEMON_UNREACHABLE: {
    id: 'DOCKER_DAEMON_UNREACHABLE',
    title: 'Docker daemon stopped responding mid-deploy',
    phase: 'container_create',
    step: '—',
    target: 'host',
    fixHint:
      "The agent's docker socket returned `connection refused` for 35s. Existing containers are unaffected. Restart the docker service on the host (`systemctl restart docker`), then re-deploy.",
    codeRefs: [
      {
        path: 'host:/var/run/docker.sock',
        line: null,
        snippet: 'connect: connection refused',
      },
    ],
  },
  DISK_EXHAUSTED: {
    id: 'DISK_EXHAUSTED',
    title: 'Build failed — host is out of disk',
    phase: 'build',
    step: '7/12',
    target: 'host',
    fixHint:
      'Image cache layer wrote 4.2GB but only 1.1GB remained. Run `docker system prune -af` or wire up the scheduled GC job (see `Web Server → Maintenance`).',
    codeRefs: [
      {
        path: 'host:/var/lib/docker',
        line: null,
        snippet: '98% used (47.1G / 48.0G)',
      },
    ],
  },
  NETWORK_DEPENDENCY_UNREACHABLE: {
    id: 'NETWORK_DEPENDENCY_UNREACHABLE',
    title: 'Docker registry timed out while pulling base image',
    phase: 'image_pull',
    step: '—',
    target: 'image "node:20-alpine"',
    fixHint:
      "docker.io was unreachable from this host (3 retries × 30s). Check the host's egress firewall, or configure a registry mirror in `/etc/docker/daemon.json`.",
    codeRefs: [{ path: 'Dockerfile.web', line: 1, snippet: 'FROM node:20-alpine' }],
  },
  HEALTHCHECK_TIMEOUT: {
    id: 'HEALTHCHECK_TIMEOUT',
    title: '`web` health check kept failing for 60s — marked unhealthy',
    phase: 'healthcheck_wait',
    step: '—',
    target: 'service "web"',
    fixHint:
      'Your `/healthz` endpoint returns 503 during startup while it warms the cache. Either bump `start_period` to 90s, or have `/healthz` return 200 once the HTTP server is bound (warm cache lazily).',
    codeRefs: [{ path: 'compose.yml', line: 14, snippet: 'healthcheck.start_period: 30s' }],
  },
  BUILD_TIMEOUT: {
    id: 'BUILD_TIMEOUT',
    title: 'Build exceeded 20m timeout',
    phase: 'build',
    step: '9/12',
    target: 'service "api"',
    fixHint:
      'Step #9 (`pnpm build`) ran for 19m 40s. Likely culprit: TypeScript checking on a cold cache. Mount `node_modules/.cache` as a buildkit cache, or move type-checking to CI.',
    codeRefs: [{ path: 'Dockerfile.api', line: 22, snippet: 'RUN pnpm --filter api build' }],
  },
};

export const ERROR_CLASS_LIST: ErrorClass[] = Object.keys(ERROR_CLASSES) as ErrorClass[];

export function getErrorClass(id: string | undefined | null): ErrorClassDef {
  if (id && (id as ErrorClass) in ERROR_CLASSES) {
    return ERROR_CLASSES[id as ErrorClass];
  }
  return ERROR_CLASSES.BUILD_CONTEXT_MISMATCH;
}
