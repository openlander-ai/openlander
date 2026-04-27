/**
 * ErrorClass taxonomy + rule-based classifier for deploy failures.
 *
 * 16-key SCREAMING_SNAKE union mirrored verbatim from v4 design's
 * `errors.jsx` registry. The UI side declares the same union in
 * `web/src/lib/errorClasses.ts`; Phase F's vitest+zod contract test
 * pins them into agreement (cross-stack import is forbidden — backend
 * cannot import from `web/`).
 *
 * The classifier is a pure rule-based mapper from observable error
 * signal to one of the 16 keys. Default branch returns `RUNTIME_CRASH`
 * (v4's most generic "something crashed" key — we deliberately do NOT
 * introduce an `UNKNOWN` key because v4's ErrorSurface relies on the
 * per-key narrative title/blame/explanation/suggestion).
 *
 * Wiring: the deploy orchestrator's catch block calls
 * `classifyDeployError(err)` and emits the result on the SSE terminal
 * `event: end` payload's `errorClass` field. See ADR-1.1 (revised) in
 * the v4 sprint plan.
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

export const ERROR_CLASS_VALUES: readonly ErrorClass[] = [
  'CONFIG_MISSING',
  'GIT_ACCESS_DENIED',
  'BUILD_CONTEXT_MISMATCH',
  'IMAGE_WRONG_STAGE',
  'DEPENDENCY_UNHEALTHY',
  'DB_EXTENSION_MISSING',
  'PORT_CONFLICT',
  'CLI_OVERRIDE_SYNTAX',
  'RUNTIME_CRASH',
  'INFRA_UNAVAILABLE',
  'OOM_KILLED',
  'DOCKER_DAEMON_UNREACHABLE',
  'DISK_EXHAUSTED',
  'NETWORK_DEPENDENCY_UNREACHABLE',
  'HEALTHCHECK_TIMEOUT',
  'BUILD_TIMEOUT',
] as const;

/**
 * Optional structured signal attached to errors thrown by the pipeline.
 * The classifier prefers structured fields when present (exit code,
 * docker reason) and falls back to message-pattern matching otherwise.
 */
export interface DeployErrorSignal {
  /** Container exit code, when available (e.g. 137 → OOM). */
  exitCode?: number;
  /** Docker reason string from inspect, e.g. `OOMKilled`. */
  dockerReason?: string;
  /** Step in the deploy pipeline (clone/build/run/healthcheck/...). */
  step?: string;
  /** Free-form error message — usually `err.message`. */
  message?: string;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
    try {
      return JSON.stringify(err);
    } catch {
      // Fallback for circular structures — produce a stable empty hint
      // rather than the lint-flagged `[object Object]` default.
      return '';
    }
  }
  if (err === null || err === undefined) return '';
  return typeof err === 'number' || typeof err === 'boolean' ? String(err) : '';
}

function extractSignal(err: unknown): DeployErrorSignal {
  if (!err || typeof err !== 'object') {
    return { message: extractMessage(err) };
  }
  const obj = err as Record<string, unknown>;
  return {
    exitCode: typeof obj['exitCode'] === 'number' ? obj['exitCode'] : undefined,
    dockerReason: typeof obj['dockerReason'] === 'string' ? obj['dockerReason'] : undefined,
    step: typeof obj['step'] === 'string' ? obj['step'] : undefined,
    message: extractMessage(err),
  };
}

/**
 * Map a raw error/unknown thrown by the deploy pipeline to one of the
 * 16 ErrorClass values. Default: `RUNTIME_CRASH`.
 *
 * Order matters: more specific signals (structured fields, exact docker
 * strings) are checked before regex/substring fallbacks.
 */
export function classifyDeployError(err: unknown): ErrorClass {
  const sig = extractSignal(err);
  const msg = sig.message ?? '';
  const lower = msg.toLowerCase();

  // --- Structured signal: container exit reason / exit code -----------------
  if (sig.dockerReason === 'OOMKilled' || sig.exitCode === 137) {
    return 'OOM_KILLED';
  }

  // --- Network / infra signals ---------------------------------------------
  // Docker daemon socket unreachable mid-deploy. Match both the literal
  // `/var/run/docker.sock` form and Docker's URL-encoded
  // `%2Fvar%2Frun%2Fdocker.sock` (the engine returns the encoded form
  // when the daemon is reachable via UNIX-domain socket addr in HTTP URLs).
  if (
    /(\/var\/run\/docker\.sock|%2Fvar%2Frun%2Fdocker\.sock|docker\.sock)/i.test(msg) &&
    /(connection refused|cannot connect|ECONNREFUSED)/i.test(msg)
  ) {
    return 'DOCKER_DAEMON_UNREACHABLE';
  }
  if (/cannot connect to the docker daemon/i.test(msg)) {
    return 'DOCKER_DAEMON_UNREACHABLE';
  }

  // Disk exhaustion.
  if (/ENOSPC/.test(msg) || /no space left on device/i.test(msg)) {
    return 'DISK_EXHAUSTED';
  }

  // Port conflict during container_start.
  if (/EADDRINUSE/.test(msg) || /port is already (allocated|in use)/i.test(msg)) {
    return 'PORT_CONFLICT';
  }
  if (/bind: address already in use/i.test(msg)) {
    return 'PORT_CONFLICT';
  }

  // --- Git access ----------------------------------------------------------
  if (/permission denied \(publickey\)/i.test(msg)) {
    return 'GIT_ACCESS_DENIED';
  }
  if (
    /(git clone|fatal:).*(authentication failed|could not read username|repository not found|403|404|401)/i.test(
      msg,
    )
  ) {
    return 'GIT_ACCESS_DENIED';
  }
  if (/remote: invalid username or password/i.test(msg)) {
    return 'GIT_ACCESS_DENIED';
  }

  // --- Image pull / registry network ---------------------------------------
  if (
    /(image pull|docker pull|pulling|failed to pull).*(timeout|i\/o timeout|no such host|dns)/i.test(
      msg,
    ) ||
    /manifest unknown.*registry/i.test(msg) ||
    /net\/http: TLS handshake timeout/i.test(msg) ||
    /net\/http: i\/o timeout/i.test(msg)
  ) {
    return 'NETWORK_DEPENDENCY_UNREACHABLE';
  }
  if (/registry.*(timeout|unreachable)/i.test(msg)) {
    return 'NETWORK_DEPENDENCY_UNREACHABLE';
  }

  // --- Build-time signals --------------------------------------------------
  // Dockerfile COPY referencing a missing path / build context mismatch.
  if (
    /(COPY|ADD)\s+.+\s+.*\b(no such file or directory|not found in build context|failed to compute cache key)/i.test(
      msg,
    )
  ) {
    return 'BUILD_CONTEXT_MISMATCH';
  }
  if (/failed to solve.*lstat .* no such file or directory/i.test(msg)) {
    return 'BUILD_CONTEXT_MISMATCH';
  }

  // Multi-stage `target:` resolves to a non-final stage.
  if (
    /target stage .* could not be found/i.test(msg) ||
    /failed to reach target stage/i.test(msg)
  ) {
    return 'IMAGE_WRONG_STAGE';
  }

  // Build timeout.
  if (
    /build (exceeded|timed out|timeout)/i.test(msg) ||
    /context deadline exceeded.*build/i.test(msg)
  ) {
    return 'BUILD_TIMEOUT';
  }

  // --- Postgres extension --------------------------------------------------
  if (
    /extension .* is not available/i.test(msg) ||
    /could not open extension control file/i.test(msg)
  ) {
    return 'DB_EXTENSION_MISSING';
  }

  // --- depends_on healthcheck failure --------------------------------------
  if (
    /dependency failed to start/i.test(msg) ||
    /service .* is unhealthy/i.test(msg) ||
    /condition .*service_healthy.* not met/i.test(msg)
  ) {
    return 'DEPENDENCY_UNHEALTHY';
  }

  // --- Healthcheck timeout (own service, not dependency) -------------------
  if (
    /health check (failed|timed out)/i.test(msg) ||
    /healthcheck.*(unhealthy|timeout)/i.test(msg) ||
    /container .* did not become healthy/i.test(msg)
  ) {
    return 'HEALTHCHECK_TIMEOUT';
  }

  // --- Required env var unset (build-time detection) -----------------------
  if (
    /Environment variable not found:\s+\w+/i.test(msg) ||
    /required env(?:ironment)? variable .* not set/i.test(msg) ||
    /missing required env/i.test(msg) ||
    /\bDATABASE_URL\b.*(not set|undefined|missing)/i.test(msg)
  ) {
    return 'CONFIG_MISSING';
  }

  // --- Custom CLI override parse failure -----------------------------------
  if (/\bdocker docker\b/.test(lower)) {
    return 'CLI_OVERRIDE_SYNTAX';
  }
  if (/custom (deploy )?command (failed to parse|parse error|invalid)/i.test(msg)) {
    return 'CLI_OVERRIDE_SYNTAX';
  }

  // --- Agent unreachable from console --------------------------------------
  if (/(agent|console).*(unreachable|cannot reach|3 retries.*30s)/i.test(msg)) {
    return 'INFRA_UNAVAILABLE';
  }

  // --- Default fallback: runtime crash -------------------------------------
  return 'RUNTIME_CRASH';
}
