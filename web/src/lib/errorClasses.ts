/**
 * Error class registry — drives FailureSummary.
 *
 * 1.0 ships ten classes (GUIDE-05 §§2.1–2.10). Names are canonical and
 * MUST match the backend's error taxonomy exactly:
 *
 *   CONFIG_MISSING
 *   GIT_ACCESS_DENIED
 *   BUILD_CONTEXT_MISMATCH
 *   IMAGE_WRONG_STAGE
 *   DEPENDENCY_UNHEALTHY
 *   DB_EXTENSION_MISSING
 *   PORT_CONFLICT
 *   CLI_OVERRIDE_SYNTAX
 *   RUNTIME_CRASH
 *   INFRA_UNAVAILABLE
 *
 * Six v1.1+ classes are intentionally NOT in this file:
 *   OOM_KILLED, DOCKER_DAEMON_UNREACHABLE, DISK_EXHAUSTED,
 *   NETWORK_DEPENDENCY_UNREACHABLE, HEALTHCHECK_TIMEOUT, BUILD_TIMEOUT.
 *
 * Renames from earlier rounds (the prototype had drift): R2's
 * PORT_COLLISION → PORT_CONFLICT, REGISTRY_UNREACHABLE →
 * NETWORK_DEPENDENCY_UNREACHABLE (deferred), HEALTHCHECK_FLAPPING →
 * HEALTHCHECK_TIMEOUT (deferred), DISK_FULL → DISK_EXHAUSTED (deferred),
 * ENV_MISSING → CONFIG_MISSING.
 *
 * The shape carries instance facts (phase, step, target, codeRefs) for
 * the prototype. The eventual backend-supplied incident payload will
 * replace these per-incident fields; the title and fix-hint stay as
 * static class metadata. We don't bother splitting today (PR4 work).
 */

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
  id: string;
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

export const ERROR_CLASSES: Record<string, ErrorClassDef> = {
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
};

export const ERROR_CLASS_LIST = Object.keys(ERROR_CLASSES);

export function getErrorClass(id: string | undefined | null): ErrorClassDef {
  if (id && ERROR_CLASSES[id]) return ERROR_CLASSES[id];
  return ERROR_CLASSES.BUILD_CONTEXT_MISMATCH;
}
