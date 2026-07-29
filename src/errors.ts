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
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class FeatureDisabledError extends OpenLanderError {
  constructor(message = 'Feature is disabled.') {
    super(message, 'FEATURE_DISABLED', 410);
    this.name = 'FeatureDisabledError';
  }
}

export class ApplicationOperationNotFoundError extends OpenLanderError {
  constructor(operationName: string) {
    super(`Application operation not found: ${operationName}`, 'OPERATION_NOT_FOUND', 404, {
      operationName,
    });
    this.name = 'ApplicationOperationNotFoundError';
  }
}

export class ApplicationOperationValidationError extends OpenLanderError {
  constructor(operationName: string, issues: unknown) {
    super(
      `Invalid input for application operation: ${operationName}`,
      'OPERATION_INVALID_INPUT',
      400,
      {
        operationName,
        issues,
      },
    );
    this.name = 'ApplicationOperationValidationError';
  }
}

export class ApplicationOperationContractError extends OpenLanderError {
  constructor(operationName: string, details?: Record<string, unknown>) {
    super(
      `Application operation contract failed: ${operationName}`,
      'OPERATION_CONTRACT_ERROR',
      500,
      { operationName, ...details },
    );
    this.name = 'ApplicationOperationContractError';
  }
}

export class ApplicationOperationScopeError extends OpenLanderError {
  constructor(operationName: string, details: Record<string, unknown>) {
    super('Actor scope does not allow this application operation.', 'SCOPE_VIOLATION', 403, {
      operationName,
      ...details,
    });
    this.name = 'ApplicationOperationScopeError';
  }
}

export class ApplicationOperationIdempotencyRequiredError extends OpenLanderError {
  constructor(operationName: string) {
    super(
      `An idempotency key is required for command: ${operationName}`,
      'OPERATION_IDEMPOTENCY_REQUIRED',
      400,
      { operationName },
    );
    this.name = 'ApplicationOperationIdempotencyRequiredError';
  }
}

export class ApplicationOperationIdempotencyConflictError extends OpenLanderError {
  constructor(operationName: string, idempotencyKey: string) {
    super(
      `Idempotency key was already used with different input: ${operationName}`,
      'OPERATION_IDEMPOTENCY_CONFLICT',
      409,
      { operationName, idempotencyKey },
    );
    this.name = 'ApplicationOperationIdempotencyConflictError';
  }
}

export class ApplicationOperationInProgressError extends OpenLanderError {
  constructor(operationName: string, operationId: string) {
    super(
      `Application operation is still running: ${operationName}`,
      'OPERATION_IN_PROGRESS',
      409,
      {
        operationName,
        operationId,
        statusCall: { method: 'GET', path: `/api/v1/operations/status/${operationId}` },
      },
    );
    this.name = 'ApplicationOperationInProgressError';
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

export class GitCredentialInvalidRepositoryError extends OpenLanderError {
  constructor(repoUrl: string, reason: string) {
    super(`Unsupported Git repository URL: ${repoUrl}`, 'GIT_CREDENTIAL_INVALID_REPOSITORY', 400, {
      repoUrl,
      reason,
      supportedProvider: 'github',
    });
    this.name = 'GitCredentialInvalidRepositoryError';
  }
}

export class GitCredentialNotFoundError extends OpenLanderError {
  constructor(credentialId: string) {
    super('Git credential not found.', 'GIT_CREDENTIAL_NOT_FOUND', 404, { credentialId });
    this.name = 'GitCredentialNotFoundError';
  }
}

export class GitCredentialInUseError extends OpenLanderError {
  constructor(credentialId: string, serviceIds: string[]) {
    super('Git credential is connected to one or more services.', 'GIT_CREDENTIAL_IN_USE', 409, {
      credentialId,
      serviceIds,
    });
    this.name = 'GitCredentialInUseError';
  }
}

export class GitDeployKeyUnauthorizedError extends OpenLanderError {
  constructor(credentialId: string, repoUrl: string, reason: string) {
    super(
      'The GitHub Deploy Key could not access this repository.',
      'GIT_DEPLOY_KEY_UNAUTHORIZED',
      403,
      { credentialId, repoUrl, reason },
    );
    this.name = 'GitDeployKeyUnauthorizedError';
  }
}

export type GitNetworkAuthMethod = 'deploy_key' | 'ssh' | 'oauth' | 'pat';

export class GitNetworkUnreachableError extends OpenLanderError {
  constructor(repoUrl: string, authMethod: GitNetworkAuthMethod) {
    super('The Git repository endpoint could not be reached.', 'GIT_NETWORK_UNREACHABLE', 503, {
      repoUrl,
      authMethod,
      retryable: true,
    });
    this.name = 'GitNetworkUnreachableError';
  }
}

export class GitCredentialRepositoryMismatchError extends OpenLanderError {
  constructor(credentialId: string, credentialRepo: string, requestedRepo: string) {
    super(
      'The selected Git credential belongs to a different repository.',
      'GIT_CREDENTIAL_REPOSITORY_MISMATCH',
      409,
      { credentialId, credentialRepo, requestedRepo },
    );
    this.name = 'GitCredentialRepositoryMismatchError';
  }
}

export class GitCredentialNotVerifiedError extends OpenLanderError {
  constructor(credentialId: string, status: string) {
    super(
      'The selected Git credential must be verified before it can be used.',
      'GIT_CREDENTIAL_NOT_VERIFIED',
      409,
      { credentialId, status },
    );
    this.name = 'GitCredentialNotVerifiedError';
  }
}

export class GitCredentialSelectionRequiredError extends OpenLanderError {
  constructor(repoUrl: string, credentialIds: string[]) {
    super(
      'Multiple verified Git credentials match this repository. Select one explicitly.',
      'GIT_CREDENTIAL_SELECTION_REQUIRED',
      409,
      { repoUrl, credentialIds },
    );
    this.name = 'GitCredentialSelectionRequiredError';
  }
}

export type GitHubRepoAccessReason =
  | 'token_invalid'
  | 'sso_required'
  | 'rate_limited'
  | 'permission_denied'
  | 'not_found_or_not_authorized'
  | 'unreachable';

export class GitHubRepoAccessError extends OpenLanderError {
  constructor(
    repoUrl: string,
    authMethod: 'oauth' | 'pat',
    reason: GitHubRepoAccessReason,
    options?: { authorizeUrl?: string; retryAt?: string },
  ) {
    const statusCode =
      reason === 'token_invalid'
        ? 401
        : reason === 'rate_limited'
          ? 429
          : reason === 'not_found_or_not_authorized'
            ? 404
            : reason === 'unreachable'
              ? 503
              : 403;
    const messages: Record<GitHubRepoAccessReason, string> = {
      token_invalid: 'The connected GitHub token is invalid or expired.',
      sso_required: 'GitHub SSO authorization is required for this repository.',
      rate_limited: 'GitHub API rate limit exceeded while checking repository access.',
      permission_denied: 'The connected GitHub credential cannot access this repository.',
      not_found_or_not_authorized:
        'The GitHub repository was not found or the connected credential is not authorized to access it.',
      unreachable: 'GitHub could not be reached to verify repository access.',
    };

    super(messages[reason], 'GITHUB_REPO_ACCESS_DENIED', statusCode, {
      reason,
      repoUrl,
      authMethod,
      ...(options?.authorizeUrl ? { authorizeUrl: options.authorizeUrl } : {}),
      ...(options?.retryAt ? { retryAt: options.retryAt } : {}),
    });
    this.name = 'GitHubRepoAccessError';
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

export class DockerBuildCancelledError extends OpenLanderError {
  constructor(projectId: string) {
    super('Docker build cancelled by user.', 'DOCKER_BUILD_CANCELLED', 409, { projectId });
    this.name = 'DockerBuildCancelledError';
  }
}

export function isDockerBuildCancelledError(error: unknown): error is DockerBuildCancelledError {
  return (
    error instanceof DockerBuildCancelledError ||
    (error instanceof OpenLanderError && error.code === 'DOCKER_BUILD_CANCELLED')
  );
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

export class NetworkAddressPoolExhaustedError extends OpenLanderError {
  constructor(networkName: string) {
    super(
      `Docker has no available address pool for network: ${networkName}`,
      'NETWORK_ADDRESS_POOL_EXHAUSTED',
      503,
      { networkName, retryable: true },
    );
    this.name = 'NetworkAddressPoolExhaustedError';
  }
}

export class NetworkCleanupBlockedError extends OpenLanderError {
  constructor(networkName: string, reason: string, details?: Record<string, unknown>) {
    super(
      `Docker network cleanup is blocked for ${networkName}: ${reason}`,
      'NETWORK_CLEANUP_BLOCKED',
      409,
      { networkName, reason, ...details },
    );
    this.name = 'NetworkCleanupBlockedError';
  }
}

export class ManagedTraefikOwnershipError extends OpenLanderError {
  constructor(containerName: string, expectedInstanceId: string, ownerInstanceId: string | null) {
    super(
      `Managed Traefik ownership check failed for ${containerName}`,
      'MANAGED_TRAEFIK_OWNERSHIP_MISMATCH',
      409,
      {
        containerName,
        expectedInstanceId,
        ownerInstanceId,
      },
    );
    this.name = 'ManagedTraefikOwnershipError';
  }
}

export class ManagedTraefikNetworkError extends OpenLanderError {
  constructor(containerName: string, networkName: string, cause: string) {
    super(
      `Managed Traefik could not attach to Docker network ${networkName}: ${cause}`,
      'MANAGED_TRAEFIK_NETWORK_FAILED',
      503,
      { containerName, networkName, cause },
    );
    this.name = 'ManagedTraefikNetworkError';
  }
}

export class ManagedTraefikRouteError extends OpenLanderError {
  constructor(projectName: string, path: string, cause: string, statusCode?: number) {
    super(
      `Managed Traefik route verification failed for ${projectName}: ${cause}`,
      'MANAGED_TRAEFIK_ROUTE_UNHEALTHY',
      502,
      {
        projectName,
        path,
        cause,
        ...(statusCode !== undefined ? { routeStatusCode: statusCode } : {}),
      },
    );
    this.name = 'ManagedTraefikRouteError';
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

/**
 * Check if a raw dockerode error is the daemon's container-name conflict.
 * Keep this string parsing at the Docker boundary so MCP never exposes the
 * daemon's full conflict message (which includes the conflicting container id).
 */
export function isDockerContainerNameConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;
  const looksLikeNameConflict =
    /conflict/i.test(message) && /container name/i.test(message) && /already in use/i.test(message);
  return looksLikeNameConflict && (status === undefined || status === 409);
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

export class ComposeHostPortsUnsupportedError extends OpenLanderError {
  constructor(
    mappings: Array<{
      service: string;
      ports: string[];
    }>,
  ) {
    super(
      'Docker Compose host port mappings are not supported by OpenLander. Remove `ports:` mappings and use `expose:` or the service container port instead.',
      'COMPOSE_HOST_PORTS_UNSUPPORTED',
      400,
      {
        mappings,
        _agent_guidance: {
          message:
            'OpenLander manages public routing through Traefik. Compose `ports:` publishes directly on the host and can break safe redeploys.',
          next_steps: [
            'Remove `ports:` from docker-compose.yml.',
            'Use `expose:` to document internal container ports if needed.',
            'Use OpenLander domains or service URLs for public access.',
          ],
        },
      },
    );
    this.name = 'ComposeHostPortsUnsupportedError';
  }
}

export class TrafficServiceRequiredError extends OpenLanderError {
  constructor(candidates: string[]) {
    super(
      'Multiple Compose applications can receive traffic. Select traffic_service explicitly.',
      'TRAFFIC_SERVICE_REQUIRED',
      400,
      { candidates },
    );
    this.name = 'TrafficServiceRequiredError';
  }
}

export class InvalidTrafficServiceError extends OpenLanderError {
  constructor(trafficService: string, candidates: string[]) {
    super(
      `Compose traffic service '${trafficService}' is not an exposed application.`,
      'INVALID_TRAFFIC_SERVICE',
      400,
      { trafficService, candidates },
    );
    this.name = 'InvalidTrafficServiceError';
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

export class ProjectSourceRemovedError extends OpenLanderError {
  constructor() {
    super(
      'Project-level repository source was removed. Create a Project first, then deploy an Application with /api/services/deploy.',
      'PROJECT_SOURCE_REMOVED',
      400,
    );
    this.name = 'ProjectSourceRemovedError';
  }
}

export class ProjectSlugImmutableError extends OpenLanderError {
  constructor(slug: string) {
    super(
      `Project slug is immutable: ${slug}. Update displayName instead.`,
      'PROJECT_SLUG_IMMUTABLE',
      400,
      { slug },
    );
    this.name = 'ProjectSlugImmutableError';
  }
}

export class ProjectHasActiveServicesError extends OpenLanderError {
  constructor(
    projectId: string,
    projectName: string,
    blockers: Array<{
      serviceId: string;
      serviceName: string;
      slug: string;
      kind: string;
      status: string | null;
    }>,
  ) {
    super(
      `Project '${projectName}' still has ${String(blockers.length)} active service(s). Delete services first.`,
      'PROJECT_HAS_ACTIVE_SERVICES',
      409,
      { projectId, projectName, blockers },
    );
    this.name = 'ProjectHasActiveServicesError';
  }
}

export class ServiceSourceMissingError extends OpenLanderError {
  constructor(serviceId: string, missingField?: 'repo_url' | 'image_url', source?: string) {
    super(
      `Service ${serviceId} is missing required source configuration${
        missingField ? ` (${missingField}${source ? ` for ${source} source` : ''})` : ''
      }`,
      'SERVICE_SOURCE_MISSING',
      400,
      {
        serviceId,
        ...(missingField ? { missingField } : {}),
        ...(source ? { source } : {}),
      },
    );
    this.name = 'ServiceSourceMissingError';
  }
}

export class InvalidSourceFieldsError extends OpenLanderError {
  constructor(message = 'Deploy source fields do not match the selected source') {
    super(message, 'INVALID_SOURCE_FIELDS', 400);
    this.name = 'InvalidSourceFieldsError';
  }
}

export class InvalidProjectTargetError extends OpenLanderError {
  constructor(projectId: string, actualName: string, providedName: string) {
    super(
      `project_id '${projectId}' has name '${actualName}', not '${providedName}'`,
      'INVALID_PROJECT_TARGET',
      400,
      { projectId, actualName, providedName },
    );
    this.name = 'InvalidProjectTargetError';
  }
}

export class ServiceSelectionRequiredError extends OpenLanderError {
  constructor(
    projectId: string,
    projectName: string,
    candidates: Array<{ serviceId: string; serviceName: string; kind: string; source: string }>,
  ) {
    const count = candidates.length;
    super(
      `Project '${projectName}' has ${String(count)} Applications. Specify service_id for the target Application.`,
      'SERVICE_SELECTION_REQUIRED',
      400,
      { projectId, projectName, candidates },
    );
    this.name = 'ServiceSelectionRequiredError';
  }
}

export class BlueGreenStabilityError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BLUE_GREEN_STABILITY_FAILED', 500, details);
    this.name = 'BlueGreenStabilityError';
  }
}

export class OperationRequiresHumanUiError extends OpenLanderError {
  constructor(operation: string, message?: string) {
    super(
      message ?? `${operation} requires the OpenLander UI confirmation flow.`,
      'OPERATION_REQUIRES_HUMAN_UI',
      409,
      { operation },
    );
    this.name = 'OperationRequiresHumanUiError';
  }
}

export class ScopeMismatchError extends OpenLanderError {
  constructor(activeScopeProjectId: string, targetProjectId: string, atExecute = false) {
    super(
      `Active MCP project scope '${activeScopeProjectId}' does not match target project '${targetProjectId}'.`,
      atExecute ? 'SCOPE_MISMATCH_AT_EXECUTE' : 'SCOPE_MISMATCH',
      403,
      { activeScopeProjectId, targetProjectId },
    );
    this.name = 'ScopeMismatchError';
  }
}

export class ScopeViolationError extends OpenLanderError {
  constructor(message: string, details: Record<string, unknown>, atExecute = false) {
    super(message, atExecute ? 'SCOPE_MISMATCH_AT_EXECUTE' : 'SCOPE_VIOLATION', 403, details);
    this.name = 'ScopeViolationError';
  }
}

export class ServiceHasConsumersError extends OpenLanderError {
  constructor(
    serviceId: string,
    serviceName: string,
    consumers: Array<{ serviceId: string; serviceName: string; projectId: string }>,
  ) {
    super(
      `Service '${serviceName}' is still referenced by ${String(consumers.length)} consumer service(s).`,
      'SERVICE_HAS_CONSUMERS',
      409,
      { serviceId, serviceName, consumers },
    );
    this.name = 'ServiceHasConsumersError';
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

export class DeploymentNotActiveError extends OpenLanderError {
  constructor(identifier: string) {
    super(`Deployment is not active: ${identifier}`, 'DEPLOYMENT_NOT_ACTIVE', 409, {
      identifier,
    });
    this.name = 'DeploymentNotActiveError';
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

export class ComposeJobFailedError extends OpenLanderError {
  constructor(serviceName: string, exitCode: number | null, error?: string) {
    super(
      `Compose job '${serviceName}' did not complete successfully.`,
      'COMPOSE_JOB_FAILED',
      409,
      { serviceName, exitCode, ...(error ? { error } : {}) },
    );
    this.name = 'ComposeJobFailedError';
  }
}

export class ComposePrerequisiteUnhealthyError extends OpenLanderError {
  constructor(serviceName: string, reason?: string) {
    super(
      `Compose prerequisite '${serviceName}' is unhealthy; the requested services were not replaced.`,
      'COMPOSE_PREREQUISITE_UNHEALTHY',
      409,
      { serviceName, ...(reason ? { reason } : {}) },
    );
    this.name = 'ComposePrerequisiteUnhealthyError';
  }
}

export class StatefulServiceChangeBlockedError extends OpenLanderError {
  constructor(serviceName: string) {
    super(
      `Stateful Compose service '${serviceName}' changed and cannot be recreated automatically.`,
      'STATEFUL_SERVICE_CHANGE_BLOCKED',
      409,
      { serviceName },
    );
    this.name = 'StatefulServiceChangeBlockedError';
  }
}

export class StatefulServiceRemovalBlockedError extends OpenLanderError {
  constructor(serviceName: string) {
    super(
      `Stateful Compose service '${serviceName}' was removed and cannot be deleted automatically.`,
      'STATEFUL_SERVICE_REMOVAL_BLOCKED',
      409,
      { serviceName },
    );
    this.name = 'StatefulServiceRemovalBlockedError';
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

/** Database/Cache/Storage resource DB persistence failed after Docker resources were cleaned up. */
export class ManagedServicePersistenceCleanedError extends OpenLanderError {
  constructor(
    serviceName: string,
    details: {
      serviceId: string;
      containerName: string;
      volumeName: string;
      hostPort: number;
      originalError: unknown;
    },
  ) {
    super(
      `Database/Cache/Storage resource "${serviceName}" could not be saved. Created Docker resources were rolled back; it is safe to retry after fixing the database error.`,
      'MANAGED_SERVICE_PERSIST_FAILED_CLEANED',
      500,
      {
        serviceName,
        serviceId: details.serviceId,
        containerName: details.containerName,
        volumeName: details.volumeName,
        hostPort: details.hostPort,
        retrySafe: true,
        rollback: {
          serviceRowDeleted: true,
          containerRemoved: true,
          volumeRemoved: true,
        },
        originalErrorCode:
          details.originalError instanceof OpenLanderError
            ? details.originalError.code
            : 'UNKNOWN_ERROR',
        _agent_guidance: {
          message:
            'OpenLander removed the Docker container and volume created during this failed create_service attempt. You can retry create_service after the database issue is fixed.',
        },
      },
    );
    this.name = 'ManagedServicePersistenceCleanedError';
  }
}

/** Database/Cache/Storage resource creation failed because the target container name exists. */
export class ManagedServiceNameConflictError extends OpenLanderError {
  constructor(
    serviceName: string,
    details: {
      containerName: string;
      volumeName: string;
      volumeRolledBack: boolean;
    },
  ) {
    super(
      `Database/Cache/Storage resource "${serviceName}" cannot be created because container "${details.containerName}" already exists.`,
      'MANAGED_SERVICE_NAME_CONFLICT',
      409,
      {
        serviceName,
        containerName: details.containerName,
        volumeName: details.volumeName,
        volumeRolledBack: details.volumeRolledBack,
        retrySafe: false,
        _agent_guidance: {
          message:
            'Inspect existing Database/Cache/Storage resources and orphan containers before retrying create_service. Choose a different resource name unless you have confirmed the existing container is stale and safe to remove.',
        },
      },
    );
    this.name = 'ManagedServiceNameConflictError';
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

// --- Delivery workspace errors ---

export class DeliveryNotFoundError extends OpenLanderError {
  constructor(deliveryId: string) {
    super(`Delivery "${deliveryId}" was not found.`, 'DELIVERY_NOT_FOUND', 404, { deliveryId });
    this.name = 'DeliveryNotFoundError';
  }
}

export class DeliveryStateError extends OpenLanderError {
  constructor(deliveryId: string, message: string, currentStatus?: string) {
    super(message, 'DELIVERY_STATE_INVALID', 409, {
      deliveryId,
      ...(currentStatus ? { currentStatus } : {}),
    });
    this.name = 'DeliveryStateError';
  }
}

export class DeliveryAgentRunNotFoundError extends OpenLanderError {
  constructor(runId: string) {
    super(`Delivery Agent Run not found: ${runId}`, 'DELIVERY_AGENT_RUN_NOT_FOUND', 404, {
      runId,
    });
    this.name = 'DeliveryAgentRunNotFoundError';
  }
}

export class DeliveryAgentRunStateError extends OpenLanderError {
  constructor(runId: string, message: string, status?: string) {
    super(message, 'DELIVERY_AGENT_RUN_STATE_INVALID', 409, { runId, status });
    this.name = 'DeliveryAgentRunStateError';
  }
}

export class DeliveryAgentRunConflictError extends OpenLanderError {
  constructor(deliveryId: string) {
    super('This Delivery already has an active Agent Run.', 'DELIVERY_AGENT_RUN_CONFLICT', 409, {
      deliveryId,
    });
    this.name = 'DeliveryAgentRunConflictError';
  }
}

export class DeliveryManifestError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DELIVERY_MANIFEST_INVALID', 400, details);
    this.name = 'DeliveryManifestError';
  }
}

export class DeliveryManifestMismatchError extends OpenLanderError {
  constructor(runId: string, details: Record<string, unknown>) {
    super(
      'Repository state does not match the Agent Run manifest snapshot.',
      'DELIVERY_MANIFEST_MISMATCH',
      409,
      { runId, ...details },
    );
    this.name = 'DeliveryManifestMismatchError';
  }
}

export class DeliveryQualityRunnerUnavailableError extends OpenLanderError {
  constructor(projectId: string, reason: string) {
    super(
      'A single Git-backed Application is required to run Delivery quality gates.',
      'DELIVERY_QUALITY_RUNNER_UNAVAILABLE',
      409,
      { projectId, reason },
    );
    this.name = 'DeliveryQualityRunnerUnavailableError';
  }
}

export class DeliveryQualityCheckTimeoutError extends OpenLanderError {
  constructor(checkKey: string, timeoutMs: number) {
    super(`Delivery quality check timed out: ${checkKey}`, 'DELIVERY_QUALITY_CHECK_TIMEOUT', 504, {
      checkKey,
      timeoutMs,
    });
    this.name = 'DeliveryQualityCheckTimeoutError';
  }
}

export class ProjectEnvironmentNotFoundError extends OpenLanderError {
  constructor(environmentId: string) {
    super('Project Environment was not found.', 'PROJECT_ENVIRONMENT_NOT_FOUND', 404, {
      environmentId,
    });
    this.name = 'ProjectEnvironmentNotFoundError';
  }
}

export class ReleaseNotFoundError extends OpenLanderError {
  constructor(releaseId: string) {
    super('Release was not found.', 'RELEASE_NOT_FOUND', 404, { releaseId });
    this.name = 'ReleaseNotFoundError';
  }
}

export class ReleaseStateError extends OpenLanderError {
  constructor(releaseId: string, message: string, status?: string) {
    super(message, 'RELEASE_STATE_INVALID', 409, { releaseId, status });
    this.name = 'ReleaseStateError';
  }
}

export class ReleaseArtifactUnavailableError extends OpenLanderError {
  constructor(releaseId: string, serviceId?: string) {
    super('Immutable Release artifact is unavailable.', 'ARTIFACT_UNAVAILABLE', 409, {
      releaseId,
      serviceId,
    });
    this.name = 'ReleaseArtifactUnavailableError';
  }
}

export class ReleaseArtifactDigestMismatchError extends OpenLanderError {
  constructor(releaseId: string, expected: string, actual: string) {
    super(
      'Release artifact digest does not match its recorded provenance.',
      'ARTIFACT_DIGEST_MISMATCH',
      409,
      {
        releaseId,
        expected,
        actual,
      },
    );
    this.name = 'ReleaseArtifactDigestMismatchError';
  }
}

export class ReleasePromotionOrderError extends OpenLanderError {
  constructor(releaseId: string, environmentId: string, prerequisiteEnvironmentId: string) {
    super(
      'Release must succeed in the previous Environment before promotion.',
      'PROMOTION_ORDER_VIOLATION',
      409,
      {
        releaseId,
        environmentId,
        prerequisiteEnvironmentId,
      },
    );
    this.name = 'ReleasePromotionOrderError';
  }
}

export class ArtifactValidationError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ARTIFACT_VALIDATION_FAILED', 400, details);
    this.name = 'ArtifactValidationError';
  }
}

export class EvidenceUploadTokenError extends OpenLanderError {
  constructor(reason: string, expired = false) {
    super(
      expired ? 'Evidence upload URL has expired.' : 'Evidence upload URL is invalid.',
      expired ? 'EVIDENCE_UPLOAD_EXPIRED' : 'EVIDENCE_UPLOAD_TOKEN_INVALID',
      expired ? 410 : 401,
      { reason },
    );
    this.name = 'EvidenceUploadTokenError';
  }
}

export class DeliveryReviewPackageFileMismatchError extends OpenLanderError {
  constructor(itemId: string, reason: string, details?: Record<string, unknown>) {
    super(
      'The uploaded file does not match the customer review package declaration.',
      'REVIEW_PACKAGE_FILE_MISMATCH',
      400,
      { itemId, reason, ...details },
    );
    this.name = 'DeliveryReviewPackageFileMismatchError';
  }
}

export class DeliveryReviewPackageExpiredError extends OpenLanderError {
  constructor(packageId: string) {
    super('The customer review package draft has expired.', 'REVIEW_PACKAGE_EXPIRED', 410, {
      packageId,
    });
    this.name = 'DeliveryReviewPackageExpiredError';
  }
}

export class DeliveryReviewPackageNotReadyError extends OpenLanderError {
  constructor(packageId: string, reason: string, details?: Record<string, unknown>) {
    super(
      'The customer review package is not ready for this operation.',
      'REVIEW_PACKAGE_NOT_READY',
      409,
      { packageId, reason, ...details },
    );
    this.name = 'DeliveryReviewPackageNotReadyError';
  }
}

export class DeliveryReviewPackageManifestMismatchError extends OpenLanderError {
  constructor(packageId: string, expected: string, actual: string) {
    super(
      'The customer review package manifest does not match the prepared revision.',
      'REVIEW_PACKAGE_MANIFEST_MISMATCH',
      409,
      { packageId, expectedManifestSha256: expected, actualManifestSha256: actual },
    );
    this.name = 'DeliveryReviewPackageManifestMismatchError';
  }
}

export class DeliveryEvidenceVersionConflictError extends OpenLanderError {
  constructor(deliveryId: string, expected: number, actual: number) {
    super(
      'The Delivery evidence changed after the customer review package was prepared.',
      'DELIVERY_EVIDENCE_VERSION_CONFLICT',
      409,
      { deliveryId, expectedEvidenceVersion: expected, actualEvidenceVersion: actual },
    );
    this.name = 'DeliveryEvidenceVersionConflictError';
  }
}

export class ArtifactNotFoundError extends OpenLanderError {
  constructor(artifactId: string) {
    super(`Artifact "${artifactId}" was not found.`, 'ARTIFACT_NOT_FOUND', 404, { artifactId });
    this.name = 'ArtifactNotFoundError';
  }
}

export class ReceiptNotReadyError extends OpenLanderError {
  constructor(deliveryId: string, blockers: string[]) {
    super('Delivery is not ready to finalize.', 'RECEIPT_NOT_READY', 409, {
      deliveryId,
      blockers,
    });
    this.name = 'ReceiptNotReadyError';
  }
}

export class ReceiptGenerationError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RECEIPT_GENERATION_FAILED', 500, details);
    this.name = 'ReceiptGenerationError';
  }
}

export class DeliveryScopeError extends OpenLanderError {
  constructor() {
    super(
      'The requested Delivery resource is outside the authenticated project scope.',
      'SCOPE_VIOLATION',
      403,
      { reason: 'target_not_found_or_out_of_scope' },
    );
    this.name = 'DeliveryScopeError';
  }
}

export class DeliveryIdempotencyError extends OpenLanderError {
  constructor() {
    super(
      'Idempotency-Key is required for CI Delivery mutations.',
      'IDEMPOTENCY_KEY_REQUIRED',
      400,
    );
    this.name = 'DeliveryIdempotencyError';
  }
}

export class DeliveryIdempotencyConflictError extends OpenLanderError {
  constructor(deliveryId: string, operation: string, idempotencyKey: string) {
    super(
      'Idempotency-Key was already used with a different Delivery request.',
      'IDEMPOTENCY_KEY_CONFLICT',
      409,
      { deliveryId, operation, idempotencyKey },
    );
    this.name = 'DeliveryIdempotencyConflictError';
  }
}

// --- Project update / durable project context errors ---

export class ProjectUpdateNotFoundError extends OpenLanderError {
  constructor(updateId: string) {
    super(`Project update "${updateId}" was not found.`, 'PROJECT_UPDATE_NOT_FOUND', 404, {
      updateId,
    });
    this.name = 'ProjectUpdateNotFoundError';
  }
}

export class ProjectUpdateItemNotFoundError extends OpenLanderError {
  constructor(itemId: string) {
    super(`Project update item "${itemId}" was not found.`, 'PROJECT_UPDATE_ITEM_NOT_FOUND', 404, {
      itemId,
    });
    this.name = 'ProjectUpdateItemNotFoundError';
  }
}

export class ProjectUpdateSourceInvalidError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PROJECT_UPDATE_SOURCE_INVALID', 400, details);
    this.name = 'ProjectUpdateSourceInvalidError';
  }
}

export class ProjectUpdateItemStatusConflictError extends OpenLanderError {
  constructor(itemId: string, expectedStatus: string, actualStatus: string) {
    super(
      'The Project Update item changed before this transition was recorded.',
      'PROJECT_UPDATE_ITEM_STATUS_CONFLICT',
      409,
      { itemId, expectedStatus, actualStatus },
    );
    this.name = 'ProjectUpdateItemStatusConflictError';
  }
}

export class ProjectUpdateProjectMismatchError extends OpenLanderError {
  constructor(projectId: string, resourceId: string, resourceType: string) {
    super(
      'The Project Update resource belongs to a different Project.',
      'PROJECT_UPDATE_PROJECT_MISMATCH',
      409,
      { projectId, resourceId, resourceType },
    );
    this.name = 'ProjectUpdateProjectMismatchError';
  }
}

// --- Engagement portfolio errors ---

export class EngagementNotFoundError extends OpenLanderError {
  constructor(engagementId: string) {
    super(`Engagement "${engagementId}" was not found.`, 'ENGAGEMENT_NOT_FOUND', 404, {
      engagementId,
    });
    this.name = 'EngagementNotFoundError';
  }
}

export class EngagementStateError extends OpenLanderError {
  constructor(engagementId: string, message: string, currentStatus?: string) {
    super(message, 'ENGAGEMENT_STATE_INVALID', 409, {
      engagementId,
      ...(currentStatus ? { currentStatus } : {}),
    });
    this.name = 'EngagementStateError';
  }
}

export class EngagementProjectConflictError extends OpenLanderError {
  constructor(projectId: string, engagementId: string) {
    super(
      `Project "${projectId}" already belongs to another Engagement.`,
      'PROJECT_ALREADY_ASSIGNED_TO_ENGAGEMENT',
      409,
      { projectId, engagementId },
    );
    this.name = 'EngagementProjectConflictError';
  }
}

export class EngagementProjectNotLinkedError extends OpenLanderError {
  constructor(engagementId: string, projectId: string) {
    super(
      `Project "${projectId}" is not linked to Engagement "${engagementId}".`,
      'ENGAGEMENT_PROJECT_NOT_LINKED',
      404,
      { engagementId, projectId },
    );
    this.name = 'EngagementProjectNotLinkedError';
  }
}

export class EngagementMutationWebSessionRequiredError extends OpenLanderError {
  constructor() {
    super(
      'Engagement mutations require an authenticated administrator web session.',
      'ENGAGEMENT_WEB_SESSION_REQUIRED',
      403,
    );
    this.name = 'EngagementMutationWebSessionRequiredError';
  }
}

export class EngagementValidationError extends OpenLanderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ENGAGEMENT_VALIDATION_FAILED', 400, details);
    this.name = 'EngagementValidationError';
  }
}

export class WeeklyReportNotFoundError extends OpenLanderError {
  constructor(reportId: string) {
    super(`Weekly report "${reportId}" was not found.`, 'WEEKLY_REPORT_NOT_FOUND', 404, {
      reportId,
    });
    this.name = 'WeeklyReportNotFoundError';
  }
}

export class WeeklyReportStateError extends OpenLanderError {
  constructor(reportId: string, message: string, currentStatus?: string) {
    super(message, 'WEEKLY_REPORT_STATE_INVALID', 409, {
      reportId,
      ...(currentStatus ? { currentStatus } : {}),
    });
    this.name = 'WeeklyReportStateError';
  }
}
