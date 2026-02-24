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
