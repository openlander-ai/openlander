/**
 * Typed error classes for OpenLander.
 *
 * Each error class maps to a specific failure domain.
 * The agent uses error types to generate user-friendly explanations.
 */

/** Base error class for all OpenLander errors. */
export class OpenLanderError extends Error {
  /** Machine-readable error code for programmatic handling. */
  readonly code: string;
  /** HTTP status code to return in API responses. */
  readonly statusCode: number;
  /** Additional context for error diagnosis. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OpenLanderError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  /** Serialize for API response. */
  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// --- Git errors ---

export class GitCloneError extends OpenLanderError {
  constructor(repoUrl: string, cause: string) {
    super(`Failed to clone ${repoUrl}: ${cause}`, 'GIT_CLONE_FAILED', 400, { repoUrl, cause });
    this.name = 'GitCloneError';
  }
}

export class GitRepoNotFoundError extends OpenLanderError {
  constructor(repoUrl: string) {
    super(
      `Repository not found: ${repoUrl}. Check the URL and your access permissions.`,
      'GIT_REPO_NOT_FOUND',
      404,
      { repoUrl },
    );
    this.name = 'GitRepoNotFoundError';
  }
}

export class GitBranchNotFoundError extends OpenLanderError {
  constructor(repoUrl: string, branch: string) {
    super(
      `Branch '${branch}' not found in ${repoUrl}. Try without specifying a branch to use the repo default.`,
      'GIT_BRANCH_NOT_FOUND',
      404,
      { repoUrl, branch },
    );
    this.name = 'GitBranchNotFoundError';
  }
}

export class GitAuthError extends OpenLanderError {
  constructor(repoUrl: string) {
    super(
      `Authentication failed for ${repoUrl}. Check your SSH key or repository permissions.`,
      'GIT_AUTH_FAILED',
      401,
      { repoUrl },
    );
    this.name = 'GitAuthError';
  }
}

/**
 * Day 13 M3 (SSRF): refused to clone or fetch a repository because the URL
 * targets an internal/loopback host or uses a non-network scheme. The agent
 * surfaces this as a plain validation error rather than a generic clone
 * failure so the UI can prompt the user for a real upstream URL.
 */
export class UnsafeRepoUrlError extends OpenLanderError {
  constructor(repoUrl: string, reason: string) {
    super(`Refusing to use repository URL "${repoUrl}": ${reason}`, 'UNSAFE_REPO_URL', 400, {
      repoUrl,
      reason,
    });
    this.name = 'UnsafeRepoUrlError';
  }
}

// --- Docker errors ---

export class DockerNotRunningError extends OpenLanderError {
  constructor() {
    super(
      'Docker daemon is not running. Please start Docker and try again.',
      'DOCKER_NOT_RUNNING',
      503,
    );
    this.name = 'DockerNotRunningError';
  }
}

export class DockerBuildError extends OpenLanderError {
  constructor(imageTag: string, buildLog: string) {
    super(
      `Docker build failed for ${imageTag}`,
      'DOCKER_BUILD_FAILED',
      500,
      { imageTag, buildLog: buildLog.slice(-2000) }, // Last 2KB of log
    );
    this.name = 'DockerBuildError';
  }
}

export class DockerfileNotFoundError extends OpenLanderError {
  constructor(contextPath: string) {
    super(
      'No Dockerfile found in the repository root. OpenLander v0.1 requires a Dockerfile.',
      'DOCKERFILE_NOT_FOUND',
      400,
      { contextPath },
    );
    this.name = 'DockerfileNotFoundError';
  }
}

export class ContainerNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Container not found: ${identifier}`, 'CONTAINER_NOT_FOUND', 404, { identifier });
    this.name = 'ContainerNotFoundError';
  }
}

export class NetworkNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Docker network not found: ${identifier}`, 'NETWORK_NOT_FOUND', 404, { identifier });
    this.name = 'NetworkNotFoundError';
  }
}

export class VolumeNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Docker volume not found: ${identifier}`, 'VOLUME_NOT_FOUND', 404, { identifier });
    this.name = 'VolumeNotFoundError';
  }
}

export class ImageNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Docker image not found: ${identifier}`, 'IMAGE_NOT_FOUND', 404, { identifier });
    this.name = 'ImageNotFoundError';
  }
}

export class MissingImageUrlError extends OpenLanderError {
  constructor() {
    super('Missing image URL for image deployment source', 'MISSING_IMAGE_URL', 400);
    this.name = 'MissingImageUrlError';
  }
}

export class ImagePullError extends OpenLanderError {
  constructor(cause: string) {
    super(cause, 'IMAGE_PULL_FAILED', 502, { cause });
    this.name = 'ImagePullError';
  }
}

export class CloudflareNotFoundError extends OpenLanderError {
  constructor(resource: string) {
    super(`Cloudflare resource not found: ${resource}`, 'CLOUDFLARE_NOT_FOUND', 404, { resource });
    this.name = 'CloudflareNotFoundError';
  }
}

/**
 * Check if a raw error from dockerode is a "not found" error.
 * Use at boundaries where raw dockerode is called directly (not via Docker wrapper).
 * Prefer `instanceof ContainerNotFoundError` etc. when the error comes from Docker class methods.
 */
export function isDockerNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /not found|No such (container|network|volume|image)/i.test(msg);
}

// --- Port errors ---

export class PortExhaustedError extends OpenLanderError {
  constructor(rangeStart: number, rangeEnd: number, usedCount: number) {
    super(
      `No available ports in range ${String(rangeStart)}-${String(rangeEnd)}. ${String(usedCount)} ports in use.`,
      'PORT_EXHAUSTED',
      503,
      { rangeStart, rangeEnd, usedCount },
    );
    this.name = 'PortExhaustedError';
  }
}

// --- Tunnel errors ---

export class TunnelStartError extends OpenLanderError {
  constructor(cause: string) {
    super(`Failed to start tunnel: ${cause}`, 'TUNNEL_START_FAILED', 500, { cause });
    this.name = 'TunnelStartError';
  }
}

export class CloudflaredNotFoundError extends OpenLanderError {
  constructor() {
    super(
      'cloudflared not found. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      'CLOUDFLARED_NOT_FOUND',
      500,
    );
    this.name = 'CloudflaredNotFoundError';
  }
}

// --- Project errors ---

export class ProjectNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Project not found: ${identifier}`, 'PROJECT_NOT_FOUND', 404, { identifier });
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectAlreadyExistsError extends OpenLanderError {
  constructor(name: string) {
    super(`Project already exists: ${name}`, 'PROJECT_ALREADY_EXISTS', 409, { name });
    this.name = 'ProjectAlreadyExistsError';
  }
}

// --- Repo not-found / persistence errors ---
//
// Each repo's mutating + post-insert verification paths throw a typed 404 (or
// 500 for create-failures) so callers can distinguish "no such row" from
// generic infrastructure errors. Plain `get*` lookups still return
// `undefined` — only mutations and post-insert verification throw.

export class EnvironmentNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Environment not found: ${identifier}`, 'ENVIRONMENT_NOT_FOUND', 404, { identifier });
    this.name = 'EnvironmentNotFoundError';
  }
}

export class ServiceNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Service not found: ${identifier}`, 'SERVICE_NOT_FOUND', 404, { identifier });
    this.name = 'ServiceNotFoundError';
  }
}

export class RuntimeIncidentNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Runtime incident not found: ${identifier}`, 'RUNTIME_INCIDENT_NOT_FOUND', 404, {
      identifier,
    });
    this.name = 'RuntimeIncidentNotFoundError';
  }
}

export class DeployPlanNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Deploy plan not found: ${identifier}`, 'DEPLOY_PLAN_NOT_FOUND', 404, { identifier });
    this.name = 'DeployPlanNotFoundError';
  }
}

export class OpsIncidentNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Ops incident not found: ${identifier}`, 'OPS_INCIDENT_NOT_FOUND', 404, { identifier });
    this.name = 'OpsIncidentNotFoundError';
  }
}

export class ServiceConnectionNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Service connection not found: ${identifier}`, 'SERVICE_CONNECTION_NOT_FOUND', 404, {
      identifier,
    });
    this.name = 'ServiceConnectionNotFoundError';
  }
}

export class ProjectDependencyNotFoundError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Project dependency not found: ${identifier}`, 'PROJECT_DEPENDENCY_NOT_FOUND', 404, {
      identifier,
    });
    this.name = 'ProjectDependencyNotFoundError';
  }
}

/**
 * Generic persistence failure raised when an `INSERT` succeeds but the
 * subsequent verification read returns no row. Indicates DB corruption or
 * concurrent deletion mid-flight.
 */
export class RepoPersistenceError extends OpenLanderError {
  constructor(entity: string, identifier: string) {
    super(
      `Failed to persist ${entity} ${identifier}: insert succeeded but verification read returned no row`,
      'REPO_PERSISTENCE_FAILED',
      500,
      { entity, identifier },
    );
    this.name = 'RepoPersistenceError';
  }
}

// --- LLM errors ---

export class LLMProviderError extends OpenLanderError {
  constructor(provider: string, cause: string) {
    super(`LLM provider error (${provider}): ${cause}`, 'LLM_PROVIDER_ERROR', 502, {
      provider,
      cause,
    });
    this.name = 'LLMProviderError';
  }
}

export class LLMNotConfiguredError extends OpenLanderError {
  constructor() {
    super(
      'No LLM provider configured. Run `openlander onboard` to set up an API key.',
      'LLM_NOT_CONFIGURED',
      400,
    );
    this.name = 'LLMNotConfiguredError';
  }
}

/**
 * Raised when the LLM agent pool is at its hard cap and no idle session can be
 * evicted to make room for a new chat session. Mapped to HTTP 429 so callers
 * can back off and retry once existing sessions complete or go idle.
 */
export class LLMConcurrencyExceededError extends OpenLanderError {
  constructor(maxPoolSize: number, activeSessions: number) {
    super(
      `LLM agent pool is full (${String(activeSessions)}/${String(maxPoolSize)} active sessions). Wait for an existing chat to finish, then retry.`,
      'LLM_CONCURRENCY_EXCEEDED',
      429,
      { maxPoolSize, activeSessions },
    );
    this.name = 'LLMConcurrencyExceededError';
  }
}

/**
 * 1.0 GA — raised when the LLM provider endpoint is unreachable
 * (ECONNREFUSED, DNS failure, AI SDK RetryError after exhausting retries on
 * a network-class error). Distinguished from {@link LLMProviderError} because
 * the user can usually fix this themselves (start Ollama, restart the LLM
 * service, check VPN). Auto-recovery catches this via {@link isLlmUnreachableError}
 * and aborts the cycle cleanly so a long-offline provider doesn't make the
 * host process crash-loop under a supervisor (systemd / pm2 / docker restart).
 *
 * NOTE: 1.0 GA does not yet wrap streamText callers to throw this typed
 * error directly — auto-recovery relies on the heuristic
 * {@link isLlmUnreachableError} against raw AI SDK errors. 1.0.x backlog:
 * wrap LLM SDK calls so the typed error becomes the documented contract.
 */
export class LLMUnreachableError extends OpenLanderError {
  constructor(provider: string, cause: string) {
    super(
      `LLM provider ${provider} is unreachable: ${cause}. Check that the provider service is running and reachable, then retry.`,
      'LLM_UNREACHABLE',
      503,
      { provider, cause },
    );
    this.name = 'LLMUnreachableError';
  }
}

/**
 * Returns true when an unknown error appears to be a connectivity/network
 * failure rather than a 4xx/5xx from a reachable LLM endpoint. Used by
 * auto-recovery and the agent layer to translate raw AI SDK errors into a
 * typed {@link LLMUnreachableError} so the recovery cycle can fail soft
 * without crashing the host process.
 *
 * Heuristics:
 * - AI SDK `RetryError`/`APICallError` whose underlying cause is network.
 * - Plain Node errors with `code` ∈ ECONNREFUSED/ENOTFOUND/EHOSTUNREACH/...
 * - Message strings matching connectivity-class patterns.
 */
export function isLlmUnreachableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    const msg = typeof error === 'string' ? error : '';
    return /econnrefused|enotfound|ehostunreach|etimedout|connection refused|connection reset|fetch failed|network/i.test(
      msg,
    );
  }

  const err = error as {
    name?: string;
    code?: string | number;
    message?: string;
    cause?: unknown;
  };

  const codeStr = typeof err.code === 'string' ? err.code : '';
  if (
    [
      'ECONNREFUSED',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'ECONNRESET',
      'EAI_AGAIN',
    ].includes(codeStr)
  ) {
    return true;
  }

  const msg = typeof err.message === 'string' ? err.message : '';
  if (
    /econnrefused|enotfound|ehostunreach|etimedout|econnreset|connection refused|connection reset|fetch failed|network error|getaddrinfo/i.test(
      msg,
    )
  ) {
    return true;
  }

  if (err.name === 'RetryError' || err.name === 'AI_RetryError') {
    // RetryError wraps the last underlying failure — recurse into cause.
    if (err.cause && err.cause !== error) {
      return isLlmUnreachableError(err.cause);
    }
    // No cause attached — treat retry exhaustion as unreachable so we
    // fail soft rather than crash on the bare RetryError instance.
    return true;
  }

  if (err.cause && err.cause !== error) {
    return isLlmUnreachableError(err.cause);
  }

  return false;
}

// --- Config errors ---

export class ConfigNotFoundError extends OpenLanderError {
  constructor() {
    super('OpenLander is not configured. Run `openlander onboard` first.', 'CONFIG_NOT_FOUND', 400);
    this.name = 'ConfigNotFoundError';
  }
}

// --- Preflight errors ---

export class PreflightCheckError extends OpenLanderError {
  constructor(
    public readonly result: {
      pass: boolean;
      checks: {
        portAvailable: { pass: boolean; detail: string };
        nameAvailable: { pass: boolean; detail: string };
        resourceOk: { pass: boolean; detail: string };
        proxyReady: { pass: boolean; detail: string };
      };
      warnings: string[];
    },
  ) {
    const failedChecks = Object.entries(result.checks)
      .filter(([, check]) => !check.pass)
      .map(([name, check]) => {
        const friendlyName = name.replace(/([A-Z])/g, ' $1').toLowerCase();
        return `${friendlyName}: ${check.detail}`;
      })
      .join('; ');

    super(`Preflight check failed: ${failedChecks}`, 'PREFLIGHT_CHECK_FAILED', 400, {
      checks: result.checks,
      warnings: result.warnings,
    });
    this.name = 'PreflightCheckError';
  }
}

// --- Authentication errors ---

export class AuthenticationError extends OpenLanderError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTHENTICATION_FAILED', 401);
    this.name = 'AuthenticationError';
  }
}

export class SetupRequiredError extends OpenLanderError {
  constructor(message = 'Setup is required before accessing this resource') {
    super(message, 'SETUP_REQUIRED', 403);
    this.name = 'SetupRequiredError';
  }
}

// --- Project state eligibility errors ---

export class ProjectArchivedError extends OpenLanderError {
  constructor(projectId: string) {
    super(
      `Project ${projectId} is archived and cannot be modified. Restore it first.`,
      'PROJECT_ARCHIVED',
      409,
      { projectId },
    );
    this.name = 'ProjectArchivedError';
  }
}

export class CircuitBreakerOpenError extends OpenLanderError {
  constructor(projectId: string) {
    super(
      `Project ${projectId} has an open circuit breaker due to repeated failures. Wait for cooldown before retrying.`,
      'CIRCUIT_BREAKER_OPEN',
      409,
      { projectId },
    );
    this.name = 'CircuitBreakerOpenError';
  }
}

export class ProjectRecoveringError extends OpenLanderError {
  constructor(projectId: string) {
    super(
      `Project ${projectId} is currently recovering. Wait for recovery to complete before making changes.`,
      'PROJECT_RECOVERING',
      409,
      { projectId },
    );
    this.name = 'ProjectRecoveringError';
  }
}

// --- Deploy lock errors ---

export class DeployLockedError extends OpenLanderError {
  constructor(projectId: string, lockedBySession: string) {
    super(
      `Project ${projectId} is currently being deployed. Try again after the current deployment completes.`,
      'DEPLOY_LOCKED',
      409,
      { projectId, lockedBySession },
    );
    this.name = 'DeployLockedError';
  }
}

// --- Project validation errors ---

export class InvalidProjectNameError extends OpenLanderError {
  constructor(name: string) {
    super(
      `Invalid project name: "${name}". Project names must start with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens.`,
      'INVALID_PROJECT_NAME',
      400,
      { name },
    );
    this.name = 'InvalidProjectNameError';
  }
}

// --- Service errors ---
//
// Day 8 Bug #6: typed errors replacing raw `throw new Error('…')` in
// service-manager.ts and tools/defs/service.ts. Lets HTTP / MCP / CLI
// callers pattern-match on `instanceof` instead of parsing message strings.

/** Service input/config validation failed (400). */
export class ServiceConfigError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SERVICE_CONFIG_INVALID', 400, details);
    this.name = 'ServiceConfigError';
  }
}

/** A service runtime/operation failed at the infra boundary (500). */
export class ServiceOperationError extends OpenLanderError {
  constructor(operation: string, message: string, details?: Record<string, unknown>) {
    super(message, 'SERVICE_OPERATION_FAILED', 500, { operation, ...details });
    this.name = 'ServiceOperationError';
  }
}

/** Operation isn't supported for the given service type (e.g. createDatabase on redis). */
export class ServiceOperationUnsupportedError extends OpenLanderError {
  constructor(operation: string, serviceType: string) {
    super(
      `${operation} is not supported for service type: ${serviceType}`,
      'SERVICE_OPERATION_UNSUPPORTED',
      400,
      { operation, serviceType },
    );
    this.name = 'ServiceOperationUnsupportedError';
  }
}

/** Service container is in a state that blocks the requested operation (e.g. stopped, missing). */
export class ServiceContainerStateError extends OpenLanderError {
  constructor(serviceId: string, state: string, message?: string) {
    super(
      message ?? `Service container ${serviceId} is in state '${state}' — operation not allowed`,
      'SERVICE_CONTAINER_STATE_INVALID',
      409,
      { serviceId, state },
    );
    this.name = 'ServiceContainerStateError';
  }
}

/** A service is referenced by other projects and cannot be removed without `force`. */
export class ServiceInUseError extends OpenLanderError {
  constructor(serviceName: string, connectedProjects: Array<{ id: string; name: string }>) {
    const projectNames = connectedProjects.map((p) => p.name).join(', ');
    const count = connectedProjects.length;
    super(
      `Service "${serviceName}" is referenced by ${String(count)} project(s): ${projectNames}. Remove the service references from their environment variables first, or use force to remove anyway.`,
      'SERVICE_IN_USE',
      409,
      { serviceName, connectedProjects },
    );
    this.name = 'ServiceInUseError';
  }
}
