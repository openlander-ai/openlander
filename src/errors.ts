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
