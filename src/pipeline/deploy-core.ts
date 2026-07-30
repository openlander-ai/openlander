import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('deploy');

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { URL } from 'node:url';
import { nanoid } from 'nanoid';
import { rm } from 'node:fs/promises';

import type { CloudflareTunnelManager } from './cloudflare.js';
import type { RuntimeBackend } from './runtime/index.js';
import { cloneRepo } from './git.js';
import { allocatePort, clearPortScanCache, releasePortReservation, scanUsedPorts } from './port.js';
import {
  appRouteProviderForTraefikMode,
  ensureManagedTraefikNetwork,
  getEnvironmentProjectHostname,
  getPreferredProjectUrl,
  getProjectUrl,
} from './traefik.js';
import { resolveContainerUrl } from './url-resolver.js';
import type { CloudflareTunnel } from './tunnel.js';
import { BuildRecovery } from './build-recovery.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import type { Database, ProjectRow, ServiceRow } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { resolveEnvVars } from './resolve-env.js';

import {
  BlueGreenStabilityError,
  ComposeEnvDeclarationRequiredError,
  ContainerNotFoundError,
  ImagePullError,
  InvalidProjectNameError,
  ManagedTraefikRouteError,
  MissingImageUrlError,
  PreflightCheckError,
  ProjectNotFoundError,
  ServiceConfigError,
  ServiceContainerStateError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
  ServiceSelectionRequiredError,
  ServiceSourceMissingError,
  StatefulApprovalStaleError,
  isDockerNotFoundError,
  isDockerBuildCancelledError,
} from '../errors.js';
import { preflightCheckOrThrow } from './preflight.js';
import { buildDeployConfig } from './build-deploy-config.js';
import type { JobManager } from './job-manager.js';
import {
  filterServicesByProfiles,
  fingerprintComposeServices,
  inferComposeRuntimeRoles,
  sanitizeComposeProjectName,
  validateComposeProfiles,
  type ComposePipeline,
} from './compose.js';
import type { AutoDetector } from './auto-detect.js';
import type { EnvManager } from './env.js';
import { DOCKER_LABELS, type OpenLanderConfig } from '../config/index.js';
import { withDeployLock } from '../db/repos/deploy-lock-helper.js';
import { assertProjectMutable } from './mutation-policy.js';
import { sleep } from '../lib/sleep.js';
import { resolveComposeFilePath, resolveComposeFilePaths } from './compose-spec.js';

import {
  extractProjectName,
  containerName as projectContainerName,
  collectKnownContainerNames,
} from './helpers.js';
import {
  getRouteName,
  deriveServiceName,
  detectFailStep,
  parsePendingFix,
} from './deploy/helpers.js';
import { ContainerLifecycle, type CoordinatorSuppressor } from './deploy/lifecycle.js';
import { RollbackExecutor } from './deploy/rollback.js';
import { TunnelManager } from './deploy/tunnel.js';
import { createLocalProbeRunner } from '../health/probe-runner.js';
import { resolveMonitoringProfile } from '../health/profile-resolver.js';
import type { HealthCheckConfig, ProbeContext, ProbeResult } from '../health/types.js';
import { BuildExecutor } from './deploy/build-step.js';
import { ContainerRunner } from './deploy/run-step.js';
import { getImageExposedPort, mapPullError } from './image-utils.js';
import { loadResourceLimitsForDeployTarget, validateStoredConfig } from './config-snapshot.js';
import { createDependencyCacheKey } from './build-cache.js';
import {
  loadServiceViewRecord,
  serviceViewFromRows,
  type ServiceView,
} from '../db/views/service-view.js';
import { deployableServiceIdToProjectId } from '../db/service-ids.js';
import { NON_DEPLOYABLE_SERVICE_KINDS } from '../db/repos/service.repo.js';
import {
  composeChildServiceName,
  resolveComposeRedeployTarget,
} from './compose-redeploy-target.js';
import {
  classifyStatefulComposeChanges,
  fingerprintComposeProject,
  type StatefulComposeApproval,
} from './compose-stateful-update.js';

import {
  buildProject,
  cloneAndAnalyze,
  extractRuntimeLogFromDeployError,
  handlePostDeploy,
  runAndVerify,
  type DeployOrchestrationDeps,
} from './deploy/orchestrator.js';
import {
  buildMonorepoResults,
  deployMonorepoService,
  rollbackMonorepoService,
  type MonorepoOrchestrationDeps,
} from './deploy/monorepo-orchestrator.js';
import { detectMonorepoDependencies } from './deploy/monorepo-deps.js';
import type { ProjectStatus, StateTransitionOptions } from '../monitor/project-state-manager.js';

interface ProjectStateTransitioner {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
}

function createFallbackStateTransitioner(db: Database): ProjectStateTransitioner {
  return {
    async transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      await db.updateProject(projectId, { status: targetStatus });
      return true;
    },
  };
}

function isProjectStateTransitioner(value: unknown): value is ProjectStateTransitioner {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { transition?: unknown }).transition === 'function',
  );
}

const TRAEFIK_HTTP_PROVIDER_POLL_INTERVAL_MS = 5_000;
const DEFAULT_BLUE_GREEN_ROUTE_SWITCH_TIMEOUT_MS =
  TRAEFIK_HTTP_PROVIDER_POLL_INTERVAL_MS * 2 + 2_000;
const DEFAULT_BLUE_GREEN_ROUTE_PROBE_INTERVAL_MS = 500;
const DEFAULT_BLUE_GREEN_POST_SWITCH_STABILITY_MS = 30_000;
const DEFAULT_BLUE_GREEN_STABILITY_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BLUE_GREEN_STABILITY_INSPECT_FAILURE_THRESHOLD = 3;
const DEFAULT_BLUE_GREEN_HEALTH_CHECK_RETRIES = 30;
const DEFAULT_BLUE_GREEN_HEALTH_CHECK_INTERVAL_MS = 2_000;
const BLUE_GREEN_LABELS = {
  ROLE: 'openlander.blue_green.role',
  PROJECT_ID: 'openlander.blue_green.project_id',
  SERVICE_ID: 'openlander.blue_green.service_id',
} as const;

type ContainerInspection = Awaited<ReturnType<RuntimeBackend['inspectContainer']>>;

type BlueGreenStabilityResult =
  | { ok: true; checks: number; elapsedMs: number }
  | { ok: false; checks: number; elapsedMs: number; error: string };

type BlueGreenHealthResult = ProbeResult & {
  attempts: number;
  elapsedMs: number;
};

function explicitHealthCheckPath(
  view: Pick<ServiceView, 'healthCheckPath'>,
  override?: string,
): string | undefined {
  const candidates = [override, view.healthCheckPath ?? undefined];
  const found = candidates.find((candidate) => candidate?.trim());
  return found ? (found.startsWith('/') ? found : `/${found}`) : undefined;
}

function parseRuntimeImageCmd(rawImageCmd: string | null): string[] | undefined {
  if (!rawImageCmd) return undefined;
  try {
    const parsed: unknown = JSON.parse(rawImageCmd);
    if (!Array.isArray(parsed)) return undefined;
    const cmd = parsed.filter((entry): entry is string => typeof entry === 'string');
    return cmd.length > 0 ? cmd : undefined;
  } catch {
    return [rawImageCmd];
  }
}

function tailLogLines(logText: string, lineCount: number): string {
  return logText.split(/\r?\n/).slice(-lineCount).join('\n');
}

/**
 * Project configuration for a deployment.
 */
export interface ProjectConfig {
  /** Repo URL (e.g., github.com/user/repo) */
  repoUrl: string;
  /** Branch to deploy (default: repo default branch) */
  branch?: string;
  /** Project name (auto-generated from repo if not provided) */
  name?: string;
  /** Environment variables */
  envVars?: Record<string, string>;
  /** Visibility mode */
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production';
  /** SSH key path for private repos */
  sshKeyPath?: string;
  /** Repository Deploy Key credential selected for this source. */
  gitCredentialId?: string;
  /** Deployment trigger source */
  trigger?: 'chat' | 'webhook' | 'api';
  /** Target environment (e.g., production, development) */
  environment?: string;
  dockerfilePath?: string;
  dockerTarget?: string;
  buildContext?: string;
  preferDockerfile?: boolean;
  force?: boolean;
  /** Preview deployment plan without building or deploying */
  dryRun?: boolean;
  /** @internal Pre-allocated project ID from startDeploy(). Do not set manually. */
  _projectId?: string;
  /** @internal Application/Compose service id that owns persisted deploy config. */
  _serviceId?: string;
  /** @internal Docker network owner Project name for target_project_id first deploys. */
  _networkProjectName?: string;
  _noCacheBuild?: boolean;
  _preferredPort?: number;
  /** @internal Preserve the live container until the new image is ready to run. */
  _preserveLiveContainerUntilRun?: boolean;
  /** @internal Runtime env that may still be provisioning while clone/build runs. */
  _deferredRuntimeEnvVars?: () => Promise<
    { ok: true; envVars: Record<string, string> } | { ok: false; error: string }
  >;
  /** @internal Deploy lock session for event-based session-scoped release. */
  _lockSessionId?: string;
  /** @internal Commit bound to an approved Stateful Compose plan. */
  _expectedCommitSha?: string;
  /** @internal Human-approved Stateful Compose replacement/removal contract. */
  _statefulComposeApproval?: StatefulComposeApproval;
  /** Specific docker-compose services to deploy. Deploys all if omitted. */
  composeServices?: string[];
  /** Repository-relative Compose file path. */
  composeFile?: string;
  /** Ordered repository-relative Compose files, from base to overlays. */
  composeFiles?: string[];
  /** Active Compose profiles. */
  composeProfiles?: string[];
  /** Compose application service used for representative public traffic. */
  trafficService?: string;
  /** Hashes of normalized Compose service definitions. */
  composeServiceFingerprints?: Record<string, string>;
  /** Deployment source type (git or pre-built image) */
  source?: 'git' | 'image';
  /** Full Docker image reference (e.g., registry.example.com/app:latest) */
  imageUrl?: string;
  /** Command override array for container entrypoint */
  imageCmd?: string[];
  /** Port the application listens on inside the container */
  containerPort?: number;
  /** HTTP path used for service health checks and route verification */
  healthCheckPath?: string;
  /** Resource profile for memory/CPU limits */
  resourceProfile?: 'micro' | 'small' | 'medium' | 'large' | 'custom' | null;
  /** Memory limit in bytes */
  memoryLimitBytes?: number | null;
}

/**
 * Result of a deployment pipeline execution.
 */
export interface DeployResult {
  success: boolean;
  projectId: string;
  projectName: string;
  code?: string;
  strategy?: RedeployStrategy;
  readiness?: 'blocked' | 'healthy' | 'unhealthy' | 'unknown';
  route_switched?: boolean;
  previous_version_still_serving?: boolean;
  warnings?: string[];
  previousImageTag?: string;
  containerId?: string;
  url?: string;
  publicUrl?: string;
  port?: number;
  commitSha?: string;
  buildDurationMs?: number;
  error?: string;
  buildLogTail?: string;
  preflightWarnings?: string[];
  cancelled?: boolean;
}

export type RedeployStrategy = 'blue-green' | 'force';

export interface RuntimeRecreateOptions {
  trigger?: 'chat' | 'webhook' | 'api';
  lockSessionId?: string;
  healthCheckPath?: string;
  healthCheckTimeoutMs?: number;
  routeSwitchDelayMs?: number;
  routeProbeIntervalMs?: number;
  routeProbeTimeoutMs?: number;
}

export interface RuntimeRecreateResult extends DeployResult {
  applyMode: 'same-image-recreate';
  containerName?: string;
  previousContainerId?: string | null;
  previousContainerName?: string | null;
}

export interface RuntimeRestartResult {
  status: 'restarted';
  projectId: string;
  serviceId: string;
  containerId: string;
}

export type ManagedRouteVerificationResult =
  | { ok: true; status: number; attempts: number; elapsedMs: number }
  | { ok: false; error: string; attempts: number; elapsedMs: number; status?: number };

export interface RedeployOptions {
  noCache?: boolean;
  strategy?: RedeployStrategy;
  healthCheckPath?: string;
  healthCheckRetries?: number;
  healthCheckIntervalMs?: number;
  /** @internal Maximum wait for Traefik HTTP provider polling after route target flip. */
  routeSwitchDelayMs?: number;
  /** @internal Poll interval while waiting for Traefik HTTP provider to expose the flipped route. */
  routeProbeIntervalMs?: number;
  /** @internal Timeout for the managed Traefik route probe. */
  routeProbeTimeoutMs?: number;
  /** @internal Public route path used only to verify ingress reachability after a flip. */
  routeProbePath?: string;
  /** @internal Keep blue serving until green survives this pre-switch observation window. */
  postSwitchStabilityMs?: number;
  /** @internal Poll interval while observing green before the route switch. */
  postSwitchStabilityPollIntervalMs?: number;
  /** @internal Non-interactive callers cannot ask the user; fall back to a deterministic workload. */
  allowMultiServiceProjectFallback?: boolean;
  cmd?: string[];
  /** @internal Explicit Compose replacement targets. An empty list means stack-level update. */
  composeServices?: string[];
  lockSessionId?: string;
  trigger?: 'chat' | 'webhook' | 'api';
  /** @internal Commit bound to a previously approved Stateful Compose plan. */
  expectedCommitSha?: string;
  /** @internal Human-approved Stateful Compose replacement/removal contract. */
  statefulComposeApproval?: StatefulComposeApproval;
}

export interface BlueGreenEligibility {
  supported: boolean;
  code: 'BLUE_GREEN_UNSUPPORTED';
  reasons: string[];
  fallback_strategy: 'force';
  service?: {
    id: string;
    name: string;
    kind: string;
    source: string | null;
    build_method: string | null;
    status: string | null;
  };
}

export interface MonorepoConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha: string;
  dockerfiles: string[];
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production';
  trigger?: 'chat' | 'webhook' | 'api';
  gitCredentialId?: string;
  /** Parent project name (auto-generated from repo if not provided) */
  name?: string;
  /** @internal Pre-allocated parent ID from startMonorepoDeploy(). Do not set manually. */
  _parentId?: string;
  /** @internal Deploy lock session for re-entrant plan-engine execution. */
  _lockSessionId?: string;
}

export interface MonorepoResult {
  success: boolean;
  parentProjectId: string;
  parentName: string;
  children: DeployResult[];
  buildDurationMs: number;
}

export interface DryRunPlan {
  projectName: string;
  repoUrl: string;
  branch?: string;
  dockerfile: string | null;
  composeDetected: boolean;
  preferDockerfile: boolean;
  envVarsProvided: number;
  existingProject: boolean;
}

export interface StartDeployResult {
  projectId: string;
  projectName: string;
  status: 'building' | 'preflight_failed' | 'dry_run';
  preflightWarnings?: string[];
  preflightError?: string;
  dryRunPlan?: DryRunPlan;
}

export interface StartMonorepoResult {
  parentProjectId: string;
  parentName: string;
  status: 'building';
}

interface PreviewDeployOptions {
  parentProjectId: string;
  previewName: string;
  repoUrl: string;
  branch: string;
  prNumber: number;
  commitSha: string;
}

interface PreviewDeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

interface PreservedLiveContainerSnapshot {
  containerId: string | null;
  containerName: string | null;
  assignedPort: number | null;
  containerPort: number | null;
  imageTag: string | null;
  previousImageTag: string | null;
}

type RestoreLiveContainerResult =
  | {
      restored: true;
      containerId: string;
      port: number;
    }
  | {
      restored: false;
      error: string;
    };

/**
 * Deterministic deployment pipeline.
 *
 * This is the core of OpenLander — rule-based, sequential execution.
 * No LLM involved. Steps:
 *   1. git clone
 *   2. Verify Dockerfile exists
 *   3. docker build
 *   4. docker run (port + Traefik labels)
 *   5. expose (TryCloudflare if requested)
 *
 * The LLM agent calls this pipeline via tools — it never executes
 * Docker commands directly.
 */
export class DeployPipeline {
  private readonly tunnelManager: TunnelManager;
  private readonly lifecycle: ContainerLifecycle;
  private readonly rollbackExecutor: RollbackExecutor;
  private readonly buildExecutor: BuildExecutor;
  private readonly containerRunner: ContainerRunner;
  private readonly stateManager: ProjectStateTransitioner;
  private readonly jobManager?: JobManager;
  private readonly composePipeline?: ComposePipeline;
  private readonly autoDetector?: AutoDetector;
  private readonly coordinator?: CoordinatorSuppressor;

  private get detectFailStep(): (buildLog: string) => string {
    return detectFailStep;
  }

  constructor(
    private readonly runtime: RuntimeBackend,
    private readonly db: Database,
    private readonly env: EnvManager,
    private readonly config: OpenLanderConfig,
    stateManagerOrJobManager?: ProjectStateTransitioner | JobManager,
    jobManagerOrComposePipeline?: JobManager | ComposePipeline,
    composePipelineOrAutoDetector?: ComposePipeline | AutoDetector,
    autoDetectorOrCoordinator?: AutoDetector | CoordinatorSuppressor,
    coordinator?: CoordinatorSuppressor,
  ) {
    const hasExplicitStateManager = isProjectStateTransitioner(stateManagerOrJobManager);
    this.stateManager = hasExplicitStateManager
      ? stateManagerOrJobManager
      : createFallbackStateTransitioner(this.db);
    this.jobManager = hasExplicitStateManager
      ? (jobManagerOrComposePipeline as JobManager | undefined)
      : (stateManagerOrJobManager as JobManager);
    this.composePipeline = hasExplicitStateManager
      ? (composePipelineOrAutoDetector as ComposePipeline | undefined)
      : (jobManagerOrComposePipeline as ComposePipeline | undefined);
    this.autoDetector = hasExplicitStateManager
      ? (autoDetectorOrCoordinator as AutoDetector | undefined)
      : (composePipelineOrAutoDetector as AutoDetector | undefined);
    this.coordinator = hasExplicitStateManager
      ? coordinator
      : (autoDetectorOrCoordinator as CoordinatorSuppressor | undefined);

    this.tunnelManager = new TunnelManager(this.db);
    this.lifecycle = new ContainerLifecycle(
      this.runtime,
      this.db,
      this.stateManager,
      this.coordinator,
    );
    const configuredTraefik = (this.config as Partial<OpenLanderConfig>).traefik;
    const routeProvider = appRouteProviderForTraefikMode(configuredTraefik?.mode ?? 'managed');
    this.rollbackExecutor = new RollbackExecutor(
      this.runtime,
      this.db,
      this.stateManager,
      routeProvider,
    );
    this.buildExecutor = new BuildExecutor(this.runtime);
    this.containerRunner = new ContainerRunner(this.runtime, this.db, routeProvider);
    void this.cleanupStaleTunnels().catch((err: unknown) => {
      log.debug({ err }, 'Stale tunnel cleanup failed');
    });
    void this.auditOrphanContainers();
  }

  /**
   * On startup, any project with quick-share/shared visibility has a dead tunnel
   * (the cloudflared child process doesn't survive restarts). Reset to internal.
   */
  private async cleanupStaleTunnels(): Promise<void> {
    await this.tunnelManager.cleanupStale();
  }

  private async auditOrphanContainers(): Promise<void> {
    try {
      const managed = await this.runtime.listManagedContainers();
      const projects = await this.db.listProjects();
      const services = await this.db.listServices();
      const environmentsByProject = await this.db.getEnvironmentsByProjectIds(
        projects.map((project) => project.id),
      );
      const { knownIds, knownNames } = collectKnownContainerNames(
        projects,
        (projectId) => environmentsByProject.get(projectId) ?? [],
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        services,
      );

      for (const container of managed) {
        if (knownIds.has(container.id)) continue;
        if (knownNames.has(container.name)) continue;
        if (container.labels?.['openlander.role']) continue;

        log.warn(
          {
            id: container.id,
            name: container.name,
            instanceId: container.labels?.[DOCKER_LABELS.INSTANCE] ?? null,
          },
          'Found unknown managed container; startup cleanup is audit-only',
        );
      }
    } catch (err) {
      log.debug({ err }, 'Orphan container audit failed — Docker may not be available');
    }
  }

  private validateProjectName(name: string): void {
    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (!PROJECT_NAME_REGEX.test(name)) {
      throw new InvalidProjectNameError(name);
    }
  }

  private async assertProjectMutable(project: ProjectRow): Promise<void> {
    const [record, circuitBreakerOpen] = await Promise.all([
      loadServiceViewRecord(this.db, project),
      this.db.isCircuitBreakerOpen(project.id),
    ]);
    assertProjectMutable(project, {
      db: {
        service: record.service,
        isCircuitBreakerOpen: () => circuitBreakerOpen,
      },
    });
  }

  private async transitionProjectState(
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    updates: Record<string, unknown> = {},
  ): Promise<void> {
    await this.stateManager.transition(projectId, targetStatus, reason);
    if (Object.keys(updates).length > 0) {
      await this.db.updateProject(projectId, updates);
    }
  }

  private async ensureFirstApplicationService(
    projectId: string,
    config: ProjectConfig,
  ): Promise<void> {
    const source = config.source ?? 'git';
    await this.db.ensureDeployableServiceForProject(projectId, {
      source,
      repoUrl: source === 'image' ? null : config.repoUrl,
      branch: source === 'image' ? null : (config.branch ?? null),
      buildMethod: config.composeServices ? 'compose' : null,
      dockerfilePath: config.dockerfilePath ?? null,
      dockerTarget: config.dockerTarget ?? null,
      buildContext: config.buildContext ?? null,
      imageUrl: config.imageUrl ?? null,
      imageCmd: config.imageCmd ?? null,
      containerPort: config.containerPort ?? null,
      healthCheckPath: config.healthCheckPath ?? null,
    });
  }

  /**
   * Start a deployment in the background (non-blocking).
   * Runs preflight check first and returns immediately if it fails.
   */
  async startDeploy(config: ProjectConfig): Promise<StartDeployResult> {
    const source = config.source ?? 'git';
    const projectName =
      config.name ??
      extractProjectName(source === 'image' ? (config.imageUrl ?? 'image') : config.repoUrl);
    this.validateProjectName(projectName);
    const projectId = nanoid(12);

    try {
      await preflightCheckOrThrow(this.db, this.runtime, projectName);
    } catch (error) {
      if (error instanceof PreflightCheckError && config.force) {
        await this.forceCleanConflicts(projectName, error);
        try {
          await preflightCheckOrThrow(this.db, this.runtime, projectName);
        } catch (retryError) {
          if (retryError instanceof PreflightCheckError) {
            return {
              projectId,
              projectName,
              status: 'preflight_failed',
              preflightError: retryError.message,
              preflightWarnings: retryError.result.warnings,
            };
          }
          throw retryError;
        }
      } else if (error instanceof PreflightCheckError) {
        return {
          projectId,
          projectName,
          status: 'preflight_failed',
          preflightError: error.message,
          preflightWarnings: error.result.warnings,
        };
      } else {
        throw error;
      }
    }

    if (config.dryRun) {
      if (source === 'image') {
        return {
          projectId: '',
          projectName,
          status: 'dry_run' as const,
          dryRunPlan: {
            projectName,
            repoUrl: config.imageUrl ?? '',
            branch: undefined,
            dockerfile: null,
            composeDetected: false,
            preferDockerfile: false,
            envVarsProvided: config.envVars ? Object.keys(config.envVars).length : 0,
            existingProject: !!(await this.db.getProjectByName(projectName)),
          },
        };
      }

      const cloneResult = await cloneRepo({
        repoUrl: config.repoUrl,
        branch: config.branch,
        sshKeyPath: config.sshKeyPath,
        gitCredentialId: config.gitCredentialId,
        serviceId: config._serviceId,
      });

      const hasExplicitDockerfilePath =
        typeof config.dockerfilePath === 'string' && config.dockerfilePath.trim().length > 0;
      const preferDockerfile = config.preferDockerfile === true || hasExplicitDockerfilePath;
      const autoDetectedComposePath =
        !preferDockerfile && !config.composeFiles && !config.composeFile
          ? (this.composePipeline?.detectComposeFile(cloneResult.path) ?? null)
          : null;
      const composePaths = preferDockerfile
        ? []
        : config.composeFiles
          ? resolveComposeFilePaths(cloneResult.path, config.composeFiles)
          : config.composeFile
            ? [resolveComposeFilePath(cloneResult.path, config.composeFile)]
            : autoDetectedComposePath
              ? [autoDetectedComposePath]
              : [];
      const dockerfilePath = join(cloneResult.path, config.dockerfilePath ?? 'Dockerfile');
      const dockerfileExists = existsSync(dockerfilePath);

      return {
        projectId: '',
        projectName,
        status: 'dry_run' as const,
        dryRunPlan: {
          projectName,
          repoUrl: config.repoUrl,
          branch: config.branch,
          dockerfile: dockerfileExists ? (config.dockerfilePath ?? 'Dockerfile') : null,
          composeDetected: composePaths.length > 0,
          preferDockerfile,
          envVarsProvided: config.envVars ? Object.keys(config.envVars).length : 0,
          existingProject: !!(await this.db.getProjectByName(projectName)),
        },
      };
    }

    // Check if project with this name already exists
    const existing = await this.db.getProjectByName(projectName);
    if (existing) {
      // Pipeline boundary policy: blocks archived/recovering/circuit-open projects
      // for callers that bypass the API route (e.g. webhook branch-target,
      // /api/deploy/start, plan engine, AI-approved fix flow).
      await this.assertProjectMutable(existing);

      const isStale = existing.status === 'error';
      if (isStale) {
        await this.db.updateProject(existing.id, {
          containerId: null,
          imageTag: null,
          assignedPort: null,
          previousImageTag: null,
          buildContext: config.buildContext ?? null,
          dockerTarget: config.dockerTarget ?? null,
        });
      }
      await this.transitionProjectState(existing.id, 'building', 'deploy-started', {
        ...(config.buildContext ? { buildContext: config.buildContext } : {}),
        ...(config.dockerfilePath ? { dockerfilePath: config.dockerfilePath } : {}),
        ...(config.dockerTarget ? { dockerTarget: config.dockerTarget } : {}),
        ...(config.healthCheckPath ? { healthCheckPath: config.healthCheckPath } : {}),
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd,
              containerPort: config.containerPort,
            }
          : {}),
      });
      this.jobManager?.trackJob(existing.id, projectName);

      this.fireAndForgetDeploy(
        {
          ...config,
          name: projectName,
          _projectId: existing.id,
          _lockSessionId: config._lockSessionId,
        },
        existing.id,
        config.trigger,
      );

      return { projectId: existing.id, projectName, status: 'building' };
    }

    // Preflight passed - create project and start background deploy
    await this.db.createProject({
      id: projectId,
      name: projectName,
      repoUrl: source === 'image' ? '' : config.repoUrl,
      branch: config.branch,
      dockerfilePath: config.dockerfilePath,
      dockerTarget: config.dockerTarget,
      buildContext: config.buildContext,
      healthCheckPath: config.healthCheckPath,
      ...(source === 'image'
        ? {
            source,
            imageUrl: config.imageUrl,
            imageCmd: config.imageCmd,
            containerPort: config.containerPort,
          }
        : {}),
    });
    await this.transitionProjectState(projectId, 'building', 'deploy-started');
    this.jobManager?.trackJob(projectId, projectName);

    this.fireAndForgetDeploy(
      {
        ...config,
        name: projectName,
        _projectId: projectId,
        _lockSessionId: config._lockSessionId,
      },
      projectId,
      config.trigger,
    );

    return { projectId, projectName, status: 'building' };
  }

  private fireAndForgetDeploy(
    config: ProjectConfig,
    projectId: string,
    trigger?: 'chat' | 'webhook' | 'api',
  ): void {
    void this.deploy(config)
      .then(async (result) => {
        if (result.cancelled) {
          return;
        }
        if (!result.success) {
          // deploy() already emitted deploy:failed in its own catch path —
          // no need to re-emit here, just record bookkeeping.
          await this.recordBackgroundFailure(
            projectId,
            result.error ?? 'Deploy returned failure',
            trigger,
            { emitTerminalEvent: false },
          );
        }
      })
      .catch((err: unknown) => {
        // Deploy threw before its own try/catch could emit deploy:failed
        // (e.g., preflight throw, project state throw, unexpected crash).
        // We must emit the terminal event so listeners (plan-engine deploy
        // lock release, questionBridge active-project clear) wake up.
        this.recordBackgroundFailure(
          projectId,
          err instanceof Error ? err.message : String(err),
          trigger,
          { emitTerminalEvent: true },
        ).catch((failureErr: unknown) => {
          log.error({ err: failureErr, projectId }, 'Failed to record background deploy failure');
        });
      });
  }

  private async recordBackgroundFailure(
    projectId: string,
    errMsg: string,
    trigger: 'chat' | 'webhook' | 'api' = 'api',
    options: { emitTerminalEvent?: boolean; attemptDeployLogWithoutServiceCheck?: boolean } = {},
  ): Promise<void> {
    log.error({ projectId, error: errMsg }, 'Background deploy failed');
    this.jobManager?.updatePhase(projectId, 'failed', errMsg);
    await this.stateManager.transition(projectId, 'error', 'deploy-failed');
    for (const env of await this.db.getEnvironmentsByProject(projectId)) {
      await this.db.updateEnvironment(env.id, { status: 'error' });
    }
    try {
      const hasDeployable =
        options.attemptDeployLogWithoutServiceCheck ||
        Boolean(await this.db.getDeployableForProject(projectId));
      if (!hasDeployable) {
        log.warn(
          { projectId, originalError: errMsg },
          'Skipping background failure deploy log because no Application service row exists',
        );
      } else if ((await this.db.getLastDeployLog(projectId))?.status !== 'failed') {
        const environments = await this.db.getEnvironmentsByProject(projectId);
        const envId = environments[0]?.id;
        await this.db.createDeployLog({
          id: nanoid(12),
          projectId,
          environmentId: envId,
          status: 'failed',
          trigger,
          buildLog: `[fatal] Deploy crashed before build: ${errMsg}`,
          durationMs: 0,
        });
      }
    } catch (err) {
      log.warn({ err, projectId }, 'Failed to persist background deploy failure log');
    }

    if (options.emitTerminalEvent) {
      // Emit deploy:failed so terminal-event listeners (plan-engine lock
      // release, questionBridge active project clear, activity logger) wake
      // up. Without this, fire-and-forget crash paths leave the plan-engine
      // deploy lock stale until the 30-minute reconciliation window.
      void eventBus.emit('deploy:failed', {
        projectId,
        step: 'startup',
        error: errMsg,
      });
    }
  }

  async startMonorepoDeploy(config: MonorepoConfig): Promise<StartMonorepoResult> {
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const existingParent = await this.db.getProjectByName(parentName);
    const parentId = existingParent?.id ?? nanoid(12);

    // Create or reuse the parent record NOW for immediate status queries.
    // Plan execution may pre-create this row so managed resources and monorepo
    // children share one target Project/network.
    if (existingParent) {
      await this.assertProjectMutable(existingParent);
    } else {
      await this.db.createProject({
        id: parentId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
      });
    }
    await this.stateManager.transition(parentId, 'building', 'deploy-started');
    this.jobManager?.trackJob(parentId, parentName);

    // Fire-and-forget: run the monorepo deploy in background
    void this.deployMonorepo({ ...config, _parentId: parentId }).catch(() => {
      // Error handling is done inside deployMonorepo()
    });

    return { parentProjectId: parentId, parentName, status: 'building' };
  }

  async deploy(config: ProjectConfig): Promise<DeployResult> {
    const source = config.source ?? 'git';
    const projectName =
      config.name ??
      extractProjectName(source === 'image' ? (config.imageUrl ?? 'image') : config.repoUrl);
    const trigger = config.trigger ?? 'api';

    // Use pre-allocated projectId from startDeploy() if available,
    // otherwise create a new one (synchronous callers like redeploy, CLI)
    const projectId = config._projectId ?? nanoid(12);

    // Day 12 (MAJOR #1): bootstrap the DB row before acquiring the lock.
    // `acquireDeployLock` runs an UPDATE WHERE id = projectId — without the
    // row, changes() returns 0 and we'd spuriously throw DeployLockedError
    // on the very first top-level call.
    if (!config._projectId) {
      await this.db.createProject({
        id: projectId,
        name: projectName,
        repoUrl: source === 'image' ? '' : config.repoUrl,
        branch: config.branch,
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd,
              containerPort: config.containerPort,
            }
          : {}),
      });
      await this.transitionProjectState(projectId, 'building', 'deploy-started');
      this.jobManager?.trackJob(projectId, projectName);
    }

    // Day 12 (MAJOR #1): every entry point is now lock-protected. When the
    // caller (redeploy, plan-engine, blue-green MCP tool) already holds the
    // lock it surfaces the session via `_lockSessionId` and we run inline
    // so the outer caller keeps owning the release lifecycle. Otherwise we
    // mint a session and wrap the body in `withDeployLock` so the explicit
    // POST /api/projects/deploy → pipeline.deploy fallback path (no agent)
    // and CLI / fire-and-forget callers cannot overlap with another deploy.
    return this.runWithDeployLockIfTopLevel(projectId, config._lockSessionId, (sessionId) =>
      this.deployInner({ ...config, _lockSessionId: sessionId }, projectId, projectName, trigger),
    );
  }

  /**
   * Wraps `fn` in `withDeployLock` only when `existingSessionId` is undefined
   * (top-level entry). Otherwise re-uses the caller's session and skips the
   * acquire/release pair so the outer `withDeployLock` keeps owning the lock.
   */
  private async runWithDeployLockIfTopLevel<T>(
    projectId: string,
    existingSessionId: string | undefined,
    fn: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    if (existingSessionId) {
      return fn(existingSessionId);
    }
    const sessionId = `deploy-${nanoid(12)}`;
    return withDeployLock(this.db, { projectId, sessionId }, () => fn(sessionId));
  }

  async getBlueGreenEligibility(
    projectId: string,
    options?: Pick<RedeployOptions, 'healthCheckPath'>,
  ): Promise<BlueGreenEligibility> {
    const reasons: string[] = [];
    const project = await this.db.getProject(projectId);
    const record = project ? await loadServiceViewRecord(this.db, project) : null;
    const deployable = record?.service ?? null;
    const view = record?.view ?? null;

    if (!project) {
      reasons.push('Project not found.');
    }
    if (!deployable) {
      reasons.push('No Application or Compose workload found.');
    }

    if (deployable && view) {
      if (view.kind === 'compose' || view.kind === 'compose-child') {
        reasons.push('Compose stacks are not eligible for blue-green deploys in v0.1.3.');
      }
      if (view.source !== 'git' && view.source !== 'image') {
        reasons.push('Blue-green deploys require a git or image Application.');
      }
      if (view.status !== 'running') {
        reasons.push('The current service must be running before blue-green can preserve it.');
      }
      if (!view.containerId) {
        reasons.push('The current service has no active container to keep serving as blue.');
      }
    }

    const traefikMode = this.config.traefik.mode;
    if (traefikMode !== 'managed') {
      reasons.push('Managed Traefik HTTP-provider routing is required for route-target flips.');
    }

    if (project && deployable && view) {
      const profile = resolveMonitoringProfile(project, deployable);
      const healthPath = explicitHealthCheckPath(view, options?.healthCheckPath);
      if (!profile.exposeViaTraefik) {
        reasons.push('The service is not exposed through OpenLander/Traefik routes.');
      }
      if (!healthPath) {
        reasons.push(
          'An explicit health_check_path is required; the default "/" probe is not enough for blue-green promotion.',
        );
      }
    }

    return {
      supported: reasons.length === 0,
      code: 'BLUE_GREEN_UNSUPPORTED',
      reasons,
      fallback_strategy: 'force',
      ...(deployable
        ? {
            service: {
              id: deployable.id,
              name: deployable.name,
              kind: deployable.kind,
              source: view?.source ?? deployable.source,
              build_method: view?.buildMethod ?? deployable.build_method,
              status: view?.status ?? deployable.status,
            },
          }
        : {}),
    };
  }

  private buildBlueGreenUnsupportedResult(
    projectId: string,
    projectName: string,
    eligibility: BlueGreenEligibility,
    startTime: number,
  ): DeployResult {
    return {
      success: false,
      projectId,
      projectName,
      code: eligibility.code,
      strategy: 'blue-green',
      readiness: 'blocked',
      route_switched: false,
      previous_version_still_serving: eligibility.service?.status === 'running',
      error: `Blue-green deploy unsupported: ${eligibility.reasons.join(' ')}`,
      buildDurationMs: Date.now() - startTime,
    };
  }

  private makeGreenContainerName(projectName: string): string {
    const suffix = Date.now().toString(36);
    return projectContainerName(`${projectName}-green-${suffix}`);
  }

  private makeGreenContainerLabels(params: {
    projectName: string;
    projectId: string;
    serviceId: string;
  }): Record<string, string> {
    return {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: params.projectName,
      [BLUE_GREEN_LABELS.ROLE]: 'green',
      [BLUE_GREEN_LABELS.PROJECT_ID]: params.projectId,
      [BLUE_GREEN_LABELS.SERVICE_ID]: params.serviceId,
      'traefik.enable': 'false',
    };
  }

  private async restoreBlueState(params: {
    projectId: string;
    environmentId?: string;
    blue: {
      containerId: string;
      containerName: string | null;
      assignedPort: number | null;
      containerPort: number | null;
      imageTag: string | null;
      previousImageTag: string | null;
    };
  }): Promise<void> {
    const { projectId, environmentId, blue } = params;
    await this.transitionProjectState(projectId, 'running', 'deploy-running', {
      containerId: blue.containerId,
      containerName: blue.containerName,
      assignedPort: blue.assignedPort,
      containerPort: blue.containerPort,
      imageTag: blue.imageTag,
      previousImageTag: blue.previousImageTag,
    });
    if (environmentId) {
      await this.db.updateEnvironment(environmentId, {
        status: 'running',
        containerId: blue.containerId,
        assignedPort: blue.assignedPort,
        containerPort: blue.containerPort,
        imageTag: blue.imageTag,
        previousImageTag: blue.previousImageTag,
      });
    }
  }

  private async probeManagedTraefikRoute(params: {
    projectName: string;
    host?: string;
    path: string;
    timeoutMs: number;
    statusPolicy?: '2xx' | 'non-5xx';
  }): Promise<{ ok: true; status: number } | { ok: false; error: string; status?: number }> {
    const host = params.host ?? getEnvironmentProjectHostname(params.projectName, 'production');
    const url = new URL(`${resolveContainerUrl(80)}${this.normalizeHealthCheckPath(params.path)}`);

    return await new Promise((resolveProbe) => {
      let settled = false;
      const settle = (
        result: { ok: true; status: number } | { ok: false; error: string; status?: number },
      ) => {
        if (settled) return;
        settled = true;
        resolveProbe(result);
      };

      const req = httpRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || '80',
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          timeout: params.timeoutMs,
          headers: { Host: host },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.resume();
          const accepted =
            params.statusPolicy === 'non-5xx'
              ? status >= 200 && status < 500
              : status >= 200 && status < 300;
          if (accepted) {
            settle({ ok: true, status });
            return;
          }
          settle({ ok: false, status, error: `Route probe returned HTTP ${String(status)}` });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Route probe timed out after ${String(params.timeoutMs)}ms`));
      });

      req.on('error', (err: Error) => {
        settle({ ok: false, error: `Route probe failed for Host(${host}): ${err.message}` });
      });

      req.end();
    });
  }

  private async waitForManagedTraefikRoute(params: {
    projectName: string;
    host?: string;
    path: string;
    probeTimeoutMs: number;
    maxWaitMs: number;
    intervalMs: number;
    minimumSuccessAgeMs?: number;
    statusPolicy?: '2xx' | 'non-5xx';
  }): Promise<ManagedRouteVerificationResult> {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, params.maxWaitMs);
    const minimumSuccessAgeMs = Math.max(0, params.minimumSuccessAgeMs ?? 0);
    let attempts = 0;
    let lastError = 'Route probe did not run';
    let lastStatus: number | undefined;

    for (;;) {
      attempts += 1;
      const probe = await this.probeManagedTraefikRoute({
        projectName: params.projectName,
        host: params.host,
        path: params.path,
        timeoutMs: params.probeTimeoutMs,
        statusPolicy: params.statusPolicy,
      });
      const elapsedMs = Date.now() - startedAt;
      if (probe.ok) {
        if (elapsedMs >= minimumSuccessAgeMs) {
          return { ok: true, status: probe.status, attempts, elapsedMs };
        }
        // A just-flipped route can still be served by Traefik's previous HTTP
        // provider snapshot. Do not treat that stale 2xx as proof of cutover.
        lastStatus = probe.status;
        lastError = `Route probe returned HTTP ${String(probe.status)} before Traefik HTTP provider poll window elapsed`;
      } else {
        lastStatus = probe.status;
        lastError = probe.error;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { ok: false, error: lastError, attempts, elapsedMs, status: lastStatus };
      }

      await sleep(Math.min(params.intervalMs, remainingMs));
    }
  }

  async verifyManagedTraefikRoute(params: {
    projectName: string;
    host?: string;
    path: string;
    probeTimeoutMs?: number;
    maxWaitMs?: number;
    intervalMs?: number;
    minimumSuccessAgeMs?: number;
    statusPolicy?: '2xx' | 'non-5xx';
  }): Promise<ManagedRouteVerificationResult> {
    const maxWaitMs = params.maxWaitMs ?? DEFAULT_BLUE_GREEN_ROUTE_SWITCH_TIMEOUT_MS;
    return await this.waitForManagedTraefikRoute({
      projectName: params.projectName,
      host: params.host,
      path: params.path,
      probeTimeoutMs: params.probeTimeoutMs ?? 5_000,
      maxWaitMs,
      intervalMs: params.intervalMs ?? DEFAULT_BLUE_GREEN_ROUTE_PROBE_INTERVAL_MS,
      statusPolicy: params.statusPolicy,
      minimumSuccessAgeMs:
        params.minimumSuccessAgeMs ?? Math.min(TRAEFIK_HTTP_PROVIDER_POLL_INTERVAL_MS, maxWaitMs),
    });
  }

  private summarizeGreenStability(
    info: ContainerInspection,
    baselineRestartCount: number,
  ): string | undefined {
    const restartCount = typeof info.RestartCount === 'number' ? info.RestartCount : 0;
    const restartDelta = Math.max(0, restartCount - baselineRestartCount);
    const exitCode =
      typeof info.State.ExitCode === 'number' ? ` (exit code: ${String(info.State.ExitCode)})` : '';

    if (info.State.Restarting) {
      return `Green container entered a restart loop${exitCode}`;
    }
    if (!info.State.Running) {
      return `Green container stopped during blue-green stability check${exitCode}`;
    }
    if (restartDelta > 0) {
      return `Green container restarted ${String(restartDelta)} time(s) during blue-green stability check`;
    }
    if (info.State.Health?.Status === 'unhealthy') {
      return 'Green container healthcheck became unhealthy during blue-green stability check';
    }
    return undefined;
  }

  private async observeBlueGreenStability(params: {
    containerId: string;
    observeMs: number;
    intervalMs: number;
  }): Promise<BlueGreenStabilityResult> {
    const startedAt = Date.now();
    const observeMs = Math.max(0, params.observeMs);
    const intervalMs = Math.max(1, params.intervalMs);
    const deadline = startedAt + observeMs;
    let checks = 0;
    let baselineRestartCount: number | null = null;
    let consecutiveInspectFailures = 0;

    for (;;) {
      checks += 1;
      try {
        const info = await this.runtime.inspectContainer(params.containerId);
        consecutiveInspectFailures = 0;
        const restartCount = typeof info.RestartCount === 'number' ? info.RestartCount : 0;
        baselineRestartCount ??= restartCount;
        const unstableReason = this.summarizeGreenStability(info, baselineRestartCount);
        const elapsedMs = Date.now() - startedAt;
        if (unstableReason) {
          return { ok: false, checks, elapsedMs, error: unstableReason };
        }
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            checks,
            elapsedMs: Date.now() - startedAt,
            error: `Green container stability could not be verified: ${message}`,
          };
        }
        consecutiveInspectFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (consecutiveInspectFailures >= DEFAULT_BLUE_GREEN_STABILITY_INSPECT_FAILURE_THRESHOLD) {
          return {
            ok: false,
            checks,
            elapsedMs: Date.now() - startedAt,
            error: `Green container stability could not be verified after ${String(consecutiveInspectFailures)} consecutive checks: ${message}`,
          };
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { ok: true, checks, elapsedMs: Date.now() - startedAt };
      }

      await sleep(Math.min(intervalMs, remainingMs));
    }
  }

  private isTerminalGreenHealthFailure(result: ProbeResult): boolean {
    const error = result.error ?? '';
    return (
      error.startsWith('Container is not running') ||
      error.startsWith('Container is restarting') ||
      error.includes('Docker health status: unhealthy')
    );
  }

  private async waitForBlueGreenHealth(params: {
    probeRunner: ReturnType<typeof createLocalProbeRunner>;
    config: HealthCheckConfig;
    context: ProbeContext;
    maxAttempts: number;
    intervalMs: number;
  }): Promise<BlueGreenHealthResult> {
    const startedAt = Date.now();
    const maxAttempts = Math.max(1, params.maxAttempts);
    const intervalMs = Math.max(1, params.intervalMs);
    let lastResult: ProbeResult = { healthy: false, source: 'none' };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      lastResult = await params.probeRunner.runProbe(
        {
          ...params.config,
          // Blue-green owns the readiness window. Keep each runner call to one
          // probe so Docker HEALTHCHECK start-period states can be observed
          // across the caller-level interval instead of collapsing into a
          // 200ms retry loop.
          failureThreshold: 1,
        },
        params.context,
      );

      if (lastResult.healthy || this.isTerminalGreenHealthFailure(lastResult)) {
        return { ...lastResult, attempts: attempt, elapsedMs: Date.now() - startedAt };
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    return { ...lastResult, attempts: maxAttempts, elapsedMs: Date.now() - startedAt };
  }

  private async deployInner(
    config: ProjectConfig,
    projectId: string,
    projectName: string,
    trigger: 'chat' | 'webhook' | 'api',
  ): Promise<DeployResult> {
    const source = config.source ?? 'git';

    if (config._projectId && !config._serviceId) {
      await this.ensureFirstApplicationService(projectId, {
        ...config,
        name: projectName,
      });
    }

    // Project row creation now lives in deploy() so we can acquire the lock
    // immediately after. Here we only apply caller overrides for existing
    // rows (config._projectId set by startDeploy or by an outer pipeline call).
    if (config._projectId && config.branch) {
      await this.db.updateProject(projectId, {
        branch: config.branch,
        repoUrl: source === 'image' ? null : config.repoUrl,
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd ? JSON.stringify(config.imageCmd) : null,
              containerPort: config.containerPort,
            }
          : {}),
      });
    } else if (config._projectId && source === 'image') {
      await this.db.updateProject(projectId, {
        source,
        imageUrl: config.imageUrl,
        imageCmd: config.imageCmd ? JSON.stringify(config.imageCmd) : null,
        containerPort: config.containerPort,
      });
    }

    // Preflight check - skip if already called from startDeploy()
    let preflightWarnings: string[] | undefined;
    if (!config._projectId) {
      try {
        const preflightResult = await preflightCheckOrThrow(this.db, this.runtime, projectName);
        preflightWarnings =
          preflightResult.warnings.length > 0 ? preflightResult.warnings : undefined;
      } catch (error) {
        if (error instanceof PreflightCheckError) {
          await this.transitionProjectState(projectId, 'error', 'deploy-build-error');
          this.jobManager?.updatePhase(projectId, 'failed', error.message);
          // F3 (Day 9): preflight failure path also returns success:false
          // without emitting deploy:failed → fireAndForget assumed deploy()
          // owned the emit and skipped it. Make this a guaranteed terminal
          // event so plan-engine lock release / questionBridge active project
          // clear / activity logger always wake up.
          await eventBus.emit('deploy:failed', {
            projectId,
            step: 'preflight',
            error: error.message,
          });
          return {
            success: false,
            projectId,
            projectName,
            error: error.message,
            preflightWarnings: error.result.warnings,
            buildDurationMs: 0,
          };
        }
        throw error;
      }
    }

    const envType = 'production' as const;
    let targetEnvironment = (await this.db.getEnvironmentsByProject(projectId)).find(
      (env) => env.type === envType,
    );

    if (!targetEnvironment) {
      targetEnvironment = await this.db.createEnvironment({
        id: `${projectId}-${envType}`,
        projectId,
        type: envType,
        branch: source === 'image' ? null : (config.branch ?? null),
      });
    }

    const result = await this.deployEnvironment(projectId, targetEnvironment.id, {
      ...config,
      _projectId: projectId,
      name: projectName,
      trigger,
    });
    if (preflightWarnings && result.preflightWarnings === undefined) {
      return { ...result, preflightWarnings };
    }
    return result;
  }

  private async restoreLiveContainerAfterSwapFailure(params: {
    projectId: string;
    environmentId: string;
    projectName: string;
    routeName: string;
    serviceId?: string;
    networkProjectName?: string;
    config: Partial<ProjectConfig>;
    snapshot: PreservedLiveContainerSnapshot;
  }): Promise<RestoreLiveContainerResult> {
    const {
      projectId,
      environmentId,
      projectName,
      routeName,
      serviceId,
      networkProjectName,
      config,
      snapshot,
    } = params;
    if (!snapshot.imageTag) {
      return { restored: false, error: 'previous image tag is missing' };
    }

    try {
      const envVars = await resolveEnvVars(
        {
          projectId,
          serviceId,
          environmentId,
          inlineEnvVars: config.envVars,
        },
        { env: this.env },
      );
      const secretFiles = await this.env.getSecretFilesForDeploy(projectId);
      const restored = await this.containerRunner.run({
        imageTag: snapshot.imageTag,
        projectName,
        containerName: routeName,
        ...(networkProjectName ? { networkProjectName } : {}),
        projectId,
        serviceId,
        preferredPort: snapshot.assignedPort ?? undefined,
        containerPort: snapshot.containerPort ?? snapshot.assignedPort ?? undefined,
        envVars,
        imageCmd: config.imageCmd,
        secretFiles,
        restartPolicy: { Name: 'unless-stopped' },
      });
      const healthResult = await this.runtime.waitForHealthy(restored.containerId, 20000);
      await eventBus.emit('monitor:healthcheck', {
        projectId,
        healthy: healthResult.healthy,
        responseTimeMs: 0,
      });
      if (!healthResult.healthy) {
        await this.runtime.safeRemoveContainer(restored.containerId).catch((err: unknown) => {
          log.warn(
            { err, projectId, containerId: restored.containerId },
            'Failed to remove unhealthy restored live container',
          );
        });
        return {
          restored: false,
          error: healthResult.error ?? 'restored previous image did not become healthy',
        };
      }
      return { restored: true, containerId: restored.containerId, port: restored.port };
    } catch (error) {
      return { restored: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deployEnvironment(
    projectId: string,
    environmentId: string,
    config: Partial<ProjectConfig> = {},
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const project = await this.db.getProject(projectId);
    if (!project) {
      // F3 (Day 9): emit deploy:failed before returning so terminal-event
      // listeners (plan-engine deploy lock release, questionBridge active-
      // project clear, activity logger) wake up. The race window is:
      // startDeploy returns → fireAndForgetDeploy starts background → project
      // is deleted → background path lands here. Without this emit, the
      // pre-existing fireAndForget contract (`emitTerminalEvent: false` when
      // deploy() returns success:false) leaves locks stale until the 30-minute
      // reconciliation window.
      const errorMsg = `Project not found: ${projectId}`;
      await eventBus.emit('deploy:failed', {
        projectId,
        step: 'lookup',
        error: errorMsg,
      });
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: errorMsg,
        buildDurationMs: Date.now() - startTime,
      };
    }
    // Pipeline boundary policy: blocks archived/recovering/circuit-open projects.
    // Throws ProjectArchivedError / ProjectRecoveringError / CircuitBreakerOpenError (409).
    await this.assertProjectMutable(project);
    const environment = await this.db.getEnvironment(environmentId);
    if (!environment || environment.project_id !== projectId) {
      // F3 (Day 9): see above — same terminal-event guarantee for the
      // environment-disappeared race.
      const errorMsg = `Environment not found: ${environmentId}`;
      await eventBus.emit('deploy:failed', {
        projectId,
        step: 'lookup',
        error: errorMsg,
      });
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: errorMsg,
        buildDurationMs: Date.now() - startTime,
      };
    }
    const deployConfig: Partial<ProjectConfig> = { ...config };
    const projectName = deployConfig.name ?? project.name;
    const trigger = deployConfig.trigger ?? 'api';
    const deployRecord = await loadServiceViewRecord(this.db, project);
    const deployService = deployConfig._serviceId
      ? ((await this.db.getService(deployConfig._serviceId)) ?? deployRecord.service)
      : deployRecord.service;
    const deployView = deployConfig._serviceId
      ? serviceViewFromRows(project, deployService)
      : deployRecord.view;
    const source = deployConfig.source ?? deployView.source ?? 'git';
    const repoUrl = deployConfig.repoUrl ?? deployView.repoUrl ?? '';
    const branch = deployConfig.branch ?? deployView.branch ?? environment.branch ?? undefined;
    if (source !== 'image' && !repoUrl) {
      // F3 (Day 9): same terminal-event guarantee for missing-repo case.
      const errorMsg = `Missing repo URL for project: ${projectId}`;
      await eventBus.emit('deploy:failed', {
        projectId,
        step: 'config',
        error: errorMsg,
      });
      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildDurationMs: Date.now() - startTime,
      };
    }
    if (source !== 'image' && deployService && !deployView.repoUrl) {
      throw new ServiceSourceMissingError(deployService.id);
    }
    const routeName = getRouteName(projectName);
    const orchestrationDeps = this.createOrchestrationDeps();
    if (deployConfig.envVars) {
      if (deployService) {
        await this.db.mergeEnvVarsForServiceDetailed(
          projectId,
          deployService.id,
          deployConfig.envVars,
        );
      } else {
        await this.db.mergeEnvVars(projectId, deployConfig.envVars);
      }
    }
    const deferredRuntimeEnvVars = deployConfig._deferredRuntimeEnvVars?.();
    const preserveLiveContainerUntilRun = deployConfig._preserveLiveContainerUntilRun === true;
    const liveContainerId = environment.container_id;
    const liveContainerView = serviceViewFromRows(project, deployService);
    const liveContainerName = liveContainerView.containerName;
    const preservedLiveContainer: PreservedLiveContainerSnapshot = {
      containerId: liveContainerId,
      containerName: liveContainerName,
      assignedPort: liveContainerView.assignedPort ?? environment.assigned_port,
      containerPort: liveContainerView.containerPort ?? environment.container_port,
      imageTag: liveContainerView.imageTag ?? environment.image_tag,
      previousImageTag: liveContainerView.previousImageTag ?? environment.previous_image_tag,
    };
    if (environment.container_id) {
      try {
        const runtimeLog = await this.runtime.getLogs(environment.container_id, 500);
        if (runtimeLog) {
          const lastLog = await this.db.getLastDeployLog(projectId, environmentId);
          if (lastLog) {
            await this.db.updateRuntimeLog(lastLog.id, runtimeLog);
          }
        }
      } catch {
        // Container may already be gone — best-effort capture
      }

      if (!preserveLiveContainerUntilRun) {
        try {
          await this.runtime.safeRemoveContainer(environment.container_id);
        } catch {
          // container may already be removed
        }
      }
    }
    await eventBus.emit('deploy:start', { projectId, repoUrl });
    if (preserveLiveContainerUntilRun) {
      await this.db.updateEnvironment(environmentId, {
        status: 'building',
        branch: source === 'image' ? null : (branch ?? null),
      });
      await this.transitionProjectState(projectId, 'building', 'deploy-started');
    } else {
      await this.db.updateEnvironment(environmentId, {
        status: 'building',
        containerId: null,
        imageTag: null,
        assignedPort: null,
        branch: source === 'image' ? null : (branch ?? null),
      });
      await this.transitionProjectState(projectId, 'building', 'deploy-started', {
        containerId: null,
        imageTag: null,
        assignedPort: null,
      });
    }
    let buildLog = '';
    let clonePath = '';
    let diffContext: string | undefined;
    let commitSha: string | undefined;
    let commitMessage: string | undefined;
    let imageTag = `openlander/${routeName}:${String(Date.now())}`;
    const previousTag = `openlander/${routeName}:previous`;
    let preservedPreviousTag: string | null = null;
    let deferredRuntimeEnvFinalized = false;
    const applyDeferredRuntimeEnvVars = async (
      mode: 'before-run' | 'after-failure' = 'before-run',
    ): Promise<void> => {
      if (!deferredRuntimeEnvVars || deferredRuntimeEnvFinalized) {
        return;
      }
      if (mode === 'before-run') {
        buildLog += '[env] Waiting for managed resource env before container start\n';
      }
      let runtimeEnv: { ok: true; envVars: Record<string, string> } | { ok: false; error: string };
      try {
        runtimeEnv = await deferredRuntimeEnvVars;
      } catch (error) {
        deferredRuntimeEnvFinalized = true;
        const envError = error instanceof Error ? error.message : String(error);
        if (mode === 'before-run') {
          throw new ServiceConfigError(`Managed resource provisioning failed: ${envError}`);
        }
        buildLog += `[env] Managed resource provisioning failed after deploy error: ${envError}\n`;
        return;
      }
      if (!runtimeEnv.ok) {
        deferredRuntimeEnvFinalized = true;
        if (mode === 'before-run') {
          throw new ServiceConfigError(`Managed resource provisioning failed: ${runtimeEnv.error}`);
        }
        buildLog += `[env] Managed resource provisioning failed after deploy error: ${runtimeEnv.error}\n`;
        return;
      }
      deployConfig.envVars = runtimeEnv.envVars;
      try {
        if (deployService) {
          await this.db.mergeEnvVarsForServiceDetailed(
            projectId,
            deployService.id,
            runtimeEnv.envVars,
          );
        } else {
          await this.db.mergeEnvVars(projectId, runtimeEnv.envVars);
        }
        deferredRuntimeEnvFinalized = true;
      } catch (error) {
        if (mode === 'before-run') {
          throw error;
        }
        const persistError = error instanceof Error ? error.message : String(error);
        buildLog += `[env] Failed to persist managed resource env after deploy error: ${persistError}\n`;
      }
    };
    if (source !== 'image') {
      const currentRunningTag = environment.image_tag ?? project.image_tag;
      if (currentRunningTag && currentRunningTag !== previousTag) {
        try {
          await this.runtime.tagImage(currentRunningTag, `openlander/${routeName}`, 'previous');

          preservedPreviousTag = currentRunningTag;
        } catch (err) {
          if (!isDockerNotFoundError(err)) {
            log.warn({ err, currentRunningTag }, 'Failed to preserve previous image for rollback');
          }
        }
      } else if (currentRunningTag === previousTag) {
        preservedPreviousTag = currentRunningTag;
      }
    } else {
      const currentRunningTag = environment.image_tag ?? project.image_tag;
      if (currentRunningTag) {
        await this.db.updateProject(projectId, { previousImageTag: currentRunningTag });
        preservedPreviousTag = currentRunningTag;
      }
    }
    let dockerfilePath: string | undefined;
    let liveContainerRemovedForSwap = false;
    try {
      if (source === 'image') {
        const imageUrl = deployConfig.imageUrl;
        if (!imageUrl) {
          throw new MissingImageUrlError();
        }

        await (
          eventBus as unknown as {
            emit(event: string, payload: Record<string, unknown>): Promise<void>;
          }
        ).emit('deploy:image-pull', { projectId, image: imageUrl });
        buildLog += `[pull] Pulling image ${imageUrl}\n`;
        try {
          await this.runtime.pullImage(imageUrl);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new ImagePullError(mapPullError(err));
        }
        await (
          eventBus as unknown as {
            emit(event: string, payload: Record<string, unknown>): Promise<void>;
          }
        ).emit('deploy:image-pulled', { projectId, image: imageUrl });
        buildLog += `[pull] Pulled image ${imageUrl}\n`;

        imageTag = imageUrl;
        if (!deployConfig.containerPort) {
          const exposedPort = await getImageExposedPort(this.runtime, imageTag);
          if (exposedPort) {
            deployConfig.containerPort = exposedPort;
            buildLog += `[image] Detected EXPOSE port ${String(exposedPort)}\n`;
          }
        }
      } else {
        const cloneResult = await cloneAndAnalyze(orchestrationDeps, {
          projectId,
          projectName,
          environmentId,
          repoUrl,
          branch,
          sshKeyPath: deployConfig.sshKeyPath,
          gitCredentialId: deployConfig.gitCredentialId,
          serviceId: deployConfig._serviceId,
          expectedCommitSha: deployConfig._expectedCommitSha,
        });
        deployConfig.gitCredentialId = cloneResult.gitCredentialId;
        clonePath = cloneResult.clonePath;
        diffContext = cloneResult.diffContext;
        buildLog = cloneResult.buildLog;
        commitSha = cloneResult.commitSha;
        commitMessage = cloneResult.commitMessage;
        const buildResult = await buildProject(orchestrationDeps, {
          projectId,
          environmentId,
          branch,
          routeName,
          trigger,
          imageTag,
          repoUrl,
          startTime,
          shouldSyncProjectState: true,
          config: deployConfig,
          clonePath: cloneResult.clonePath,
          commitSha: cloneResult.commitSha,
          sourceRevisionChanged: cloneResult.sourceRevisionChanged,
          buildLog,
          environmentType: environment.type,
        });
        buildLog = buildResult.buildLog;
        if (buildResult.type === 'compose') {
          return buildResult.result;
        }
        dockerfilePath = buildResult.dockerfilePath;
      }

      await applyDeferredRuntimeEnvVars();

      if (preserveLiveContainerUntilRun) {
        const containersToRemove = Array.from(
          new Set(
            [liveContainerId, liveContainerName, projectContainerName(routeName)].filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            ),
          ),
        );
        for (const containerRef of containersToRemove) {
          try {
            await this.runtime.safeRemoveContainer(containerRef);
          } catch {
            // container may already be removed
          }
        }
        liveContainerRemovedForSwap = true;
      }

      const runResult = await runAndVerify(orchestrationDeps, {
        projectId,
        environmentId,
        projectName,
        routeName,
        environmentType: environment.type,
        imageTag,
        dockerfilePath,
        previousEnvironmentImageTag: preservedPreviousTag ?? environment.image_tag,
        previousProjectImageTag: preservedPreviousTag ?? project.image_tag ?? null,
        shouldSyncProjectState: true,
        config: deployConfig,
        buildLog,
      });
      buildLog = runResult.buildLog;

      const configuredTraefik = (this.config as Partial<OpenLanderConfig>).traefik;
      const monitoringProfile = resolveMonitoringProfile(project, deployService);
      if (configuredTraefik?.mode === 'managed' && monitoringProfile.exposeViaTraefik) {
        const explicitRoutePath = explicitHealthCheckPath(deployView, deployConfig.healthCheckPath);
        const routePath = explicitRoutePath ?? monitoringProfile.health.path ?? '/';
        buildLog += `[route] Verifying managed Traefik ingress at ${routePath}\n`;
        const routeProbe = await this.verifyManagedTraefikRoute({
          projectName,
          path: routePath,
          statusPolicy: explicitRoutePath ? '2xx' : 'non-5xx',
        });
        if (!routeProbe.ok) {
          buildLog += `[route] Failed: ${routeProbe.error}\n`;
          throw new ManagedTraefikRouteError(
            projectName,
            routePath,
            routeProbe.error,
            routeProbe.status,
          );
        }
        buildLog += `[route] Passed (HTTP ${String(routeProbe.status)}) after ${String(routeProbe.elapsedMs)}ms (${String(routeProbe.attempts)} attempt(s))\n`;
      }

      const postDeploy = await handlePostDeploy(orchestrationDeps, {
        projectId,
        environmentId,
        config: deployConfig,
        repoUrl,
        trigger,
        startTime,
        buildLog,
        commitSha,
        commitMessage,
        shouldSyncProjectState: true,
        port: runResult.port,
        internalUrl: runResult.internalUrl,
      });
      return {
        success: true,
        projectId,
        projectName,
        containerId: runResult.containerId,
        url: runResult.internalUrl,
        publicUrl: postDeploy.publicUrl,
        port: runResult.port,
        commitSha,
        buildDurationMs: postDeploy.totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const attachedLog = (error as Error & { buildLog?: string }).buildLog;
      if (attachedLog) {
        buildLog = attachedLog;
      }
      if (isDockerBuildCancelledError(error)) {
        const durationMs = Date.now() - startTime;
        const cancelMessage = 'Build cancelled by user';
        this.jobManager?.updatePhase(projectId, 'failed', cancelMessage);
        await applyDeferredRuntimeEnvVars('after-failure');
        const buildLogWithCancel = buildLog + `[cancelled] ${cancelMessage}\n`;
        if (preserveLiveContainerUntilRun && !liveContainerRemovedForSwap) {
          await this.db.updateEnvironment(environmentId, { status: 'running' });
          await this.transitionProjectState(projectId, 'running', 'deploy-cancelled');
        } else {
          await this.db.updateEnvironment(environmentId, { status: 'stopped' });
          await this.transitionProjectState(projectId, 'stopped', 'deploy-cancelled');
        }
        await this.db.createDeployLog({
          id: nanoid(12),
          projectId,
          environmentId,
          status: 'cancelled',
          trigger,
          commitSha,
          commitMessage,
          buildLog: buildLogWithCancel,
          durationMs,
        });
        await eventBus.emit('deploy:failed', {
          projectId,
          step: 'cancelled',
          error: cancelMessage,
          buildLog: buildLogWithCancel,
          diffContext,
          sessionId: deployConfig._lockSessionId,
          cancelled: true,
          phase: 'build',
          status: 'failed',
          message: cancelMessage,
          durationMs,
        });
        return {
          success: false,
          projectId,
          projectName,
          error: cancelMessage,
          buildDurationMs: durationMs,
          cancelled: true,
        };
      }
      await applyDeferredRuntimeEnvVars('after-failure');
      const failStep = this.detectFailStep(buildLog);
      const attachedRuntimeLog = extractRuntimeLogFromDeployError(error);
      const runtimeLog =
        attachedRuntimeLog ??
        (failStep === 'run' || failStep === 'runtime'
          ? await this.captureProjectRuntimeLog(projectId)
          : undefined);
      const buildLogWithError = buildLog + `[error] ${errorMsg}\n`;
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      if (!preserveLiveContainerUntilRun || liveContainerRemovedForSwap) {
        try {
          const containerName = projectContainerName(routeName);
          await this.runtime.safeRemoveContainer(containerName);
          log.info({ projectId, containerName }, 'Cleaned up orphan container after failed deploy');
        } catch {
          // container may not exist — that's fine
        }
      }
      let restoredLiveContainer: RestoreLiveContainerResult | undefined;
      if (preserveLiveContainerUntilRun && liveContainerRemovedForSwap) {
        restoredLiveContainer = await this.restoreLiveContainerAfterSwapFailure({
          projectId,
          environmentId,
          projectName,
          routeName,
          serviceId: deployService?.id,
          networkProjectName: deployConfig._networkProjectName,
          config: deployConfig,
          snapshot: preservedLiveContainer,
        });
        if (restoredLiveContainer.restored) {
          buildLog += `[rollback] restored previous container ${restoredLiveContainer.containerId.slice(0, 12)} after swap failure\n`;
        } else {
          buildLog += `[rollback] failed to restore previous container after swap failure: ${restoredLiveContainer.error}\n`;
        }
      }

      // Classify for build-log context only; OpenLander 0.1 does not auto-remediate.
      try {
        const recovery = new BuildRecovery();
        const classification = recovery.classify(buildLogWithError, {
          projectId,
          projectName,
          imageTag,
          clonePath,
          buildLog: buildLogWithError,
          failedStep: failStep as 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime',
        });
        this.jobManager?.setAutoDiagnosis(projectId, {
          category: classification.category,
          tier: classification.tier,
          cause: classification.message,
          autoFixable: false,
          suggestedAction: classification.suggestedAction,
        });
      } catch (classifyError) {
        log.warn({ err: classifyError, projectId }, 'Build failure classification failed');
      }
      if (preserveLiveContainerUntilRun && !liveContainerRemovedForSwap) {
        await this.db.updateEnvironment(environmentId, { status: 'running' });
        await this.transitionProjectState(projectId, 'running', 'deploy-failed');
      } else if (restoredLiveContainer?.restored) {
        await this.db.updateEnvironment(environmentId, {
          status: 'running',
          containerId: restoredLiveContainer.containerId,
          assignedPort: restoredLiveContainer.port,
          containerPort: preservedLiveContainer.containerPort,
          imageTag: preservedLiveContainer.imageTag,
          previousImageTag: preservedLiveContainer.previousImageTag,
        });
        await this.transitionProjectState(projectId, 'running', 'deploy-swap-rollback', {
          containerId: restoredLiveContainer.containerId,
          containerName: preservedLiveContainer.containerName ?? projectContainerName(routeName),
          assignedPort: restoredLiveContainer.port,
          containerPort: preservedLiveContainer.containerPort,
          imageTag: preservedLiveContainer.imageTag,
          previousImageTag: preservedLiveContainer.previousImageTag,
        });
      } else {
        await this.db.updateEnvironment(environmentId, { status: 'error' });
        await this.transitionProjectState(projectId, 'error', 'deploy-failed');
      }
      await this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'failed',
        trigger,
        commitSha,
        commitMessage,
        buildLog: buildLogWithError,
        runtimeLog,
        durationMs: Date.now() - startTime,
      });
      await eventBus.emit('deploy:failed', {
        projectId,
        step: failStep,
        error: errorMsg,
        buildLog: buildLogWithError,
        diffContext,
        sessionId: deployConfig._lockSessionId,
      });
      const logLines = buildLogWithError.split('\n').filter(Boolean);
      const buildLogTail = logLines.slice(-100).join('\n');
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg, buildLogTail);
      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildLogTail,
        buildDurationMs: Date.now() - startTime,
      };
    } finally {
      if (clonePath) {
        try {
          const { rmSync } = await import('node:fs');
          rmSync(clonePath, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private createOrchestrationDeps(): DeployOrchestrationDeps {
    return {
      runtime: this.runtime,
      db: this.db,
      env: this.env,
      stateManager: this.stateManager,
      buildExecutor: this.buildExecutor,
      containerRunner: this.containerRunner,
      composePipeline: this.composePipeline,
      autoDetector: this.autoDetector,
      jobManager: this.jobManager,
      applyPendingFix: (projectId: string, clonePath: string) =>
        this.applyPendingFix(projectId, clonePath),
      exposeTunnel: (projectId: string, port: number) => this.exposeTunnel(projectId, port),
      secretScanEnabled: this.config.ai.secretScan.enabled,
    };
  }

  private createMonorepoDeps(): MonorepoOrchestrationDeps {
    return {
      runtime: this.runtime,
      db: this.db,
      env: this.env,
      stateManager: this.stateManager,
      buildExecutor: this.buildExecutor,
      containerRunner: this.containerRunner,
      jobManager: this.jobManager,
    };
  }

  async deployMonorepo(config: MonorepoConfig): Promise<MonorepoResult> {
    const startTime = Date.now();
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const trigger = config.trigger ?? 'api';

    // Use pre-allocated parentId from startMonorepoDeploy() if available
    const parentId = config._parentId ?? nanoid(12);

    if (!config._parentId) {
      await this.db.createProject({
        id: parentId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
      });
      await this.transitionProjectState(parentId, 'building', 'deploy-started');
      this.jobManager?.trackJob(parentId, parentName);
    }

    return this.runWithDeployLockIfTopLevel(parentId, config._lockSessionId, () =>
      this.deployMonorepoInner(config, parentId, parentName, trigger, startTime),
    );
  }

  private async deployMonorepoInner(
    config: MonorepoConfig,
    parentId: string,
    parentName: string,
    trigger: 'chat' | 'webhook' | 'api',
    startTime: number,
  ): Promise<MonorepoResult> {
    await eventBus.emit('deploy:start', {
      projectId: parentId,
      repoUrl: config.repoUrl,
      phase: 'orchestrate',
      scope: 'parent',
      status: 'in_progress',
      message: `Starting monorepo deploy (${String(config.dockerfiles.length)} services)`,
    });
    await eventBus.emit('deploy:clone', {
      projectId: parentId,
      path: config.clonePath,
      commitSha: config.commitSha,
      phase: 'clone',
      scope: 'parent',
      status: 'success',
      message: `Using cloned repository (${config.commitSha.slice(0, 7)})`,
    });

    const serviceNameCounts = new Map<string, number>();
    const services: ServiceNode[] = config.dockerfiles.map((dockerfilePath) => {
      const baseName = deriveServiceName(dockerfilePath);
      const count = (serviceNameCounts.get(baseName) ?? 0) + 1;
      serviceNameCounts.set(baseName, count);
      const serviceName = count === 1 ? baseName : `${baseName}-${String(count)}`;
      return {
        name: serviceName,
        dockerfile: dockerfilePath,
        dependsOn: [],
      };
    });

    // PR 2: fetch existing children via services.parent_service_id.
    const existingChildren = await this.db.getComposeChildProjects(parentId);
    const existingChildEnvVarsByService = new Map<string, Record<string, string>>();
    await Promise.all(
      services.map(async (service) => {
        const childName = `${parentName}/${service.name}`;
        const existingChild = existingChildren.find((child) => child.name === childName);
        if (existingChild) {
          existingChildEnvVarsByService.set(
            service.name,
            await this.env.getAllForService(existingChild.id, `${existingChild.id}__svc`),
          );
        }
      }),
    );
    detectMonorepoDependencies(services, parentName, (serviceName) => {
      const envVarsToScan: Record<string, string> = {};
      Object.assign(envVarsToScan, existingChildEnvVarsByService.get(serviceName) ?? {});

      if (config.envVars) {
        Object.assign(envVarsToScan, config.envVars);
      }

      return envVarsToScan;
    });

    const serviceNames = new Set(services.map((s) => s.name));
    if (serviceNames.has('app') && !serviceNames.has('main')) {
      const legacyChildren = existingChildren.filter((c) => c.name === `${parentName}/main`);
      for (const child of legacyChildren) {
        if (child.container_id) {
          try {
            await this.runtime.safeRemoveContainer(child.container_id);
          } catch {
            /* best effort */
          }
        }
        await this.transitionProjectState(child.id, 'stopped', 'deploy-failed', {
          containerId: null,
        });
        log.info(
          { childId: child.id, oldName: child.name },
          'Cleaned up legacy "main" child (renamed to "app")',
        );
      }
    }

    const orchestrator = new DeployOrchestrator();
    let topology;
    try {
      topology = orchestrator.buildTopology(
        services,
        config.repoUrl,
        config.clonePath,
        config.commitSha,
        config.branch,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.transitionProjectState(parentId, 'error', 'deploy-failed');
      this.jobManager?.updatePhase(parentId, 'failed', errorMsg);
      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'topology',
        error: errorMsg,
        phase: 'orchestrate',
        scope: 'parent',
        status: 'failed',
        message: `Monorepo topology build failed: ${errorMsg}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        parentProjectId: parentId,
        parentName,
        children: services.map((service) => ({
          success: false,
          projectId: '',
          projectName: `${parentName}/${service.name}`,
          error: `Topology build failed: ${errorMsg}`,
          buildDurationMs: Date.now() - startTime,
        })),
        buildDurationMs: Date.now() - startTime,
      };
    }

    const usedPorts = (await scanUsedPorts(this.db, this.runtime)).all;
    const validation = orchestrator.validateTopology(topology, usedPorts);
    if (!validation.valid) {
      const validationError = validation.errors.join('; ');
      await this.transitionProjectState(parentId, 'error', 'deploy-failed');
      this.jobManager?.updatePhase(parentId, 'failed', validationError);
      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'topology',
        error: validationError,
        phase: 'orchestrate',
        scope: 'parent',
        status: 'failed',
        message: `Monorepo topology validation failed: ${validationError}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        parentProjectId: parentId,
        parentName,
        children: services.map((service) => ({
          success: false,
          projectId: '',
          projectName: `${parentName}/${service.name}`,
          error: `Topology validation failed: ${validationError}`,
          buildDurationMs: Date.now() - startTime,
        })),
        buildDurationMs: Date.now() - startTime,
      };
    }

    const resultByService = new Map<string, DeployResult>();
    const monorepoDeps = this.createMonorepoDeps();

    const orchestration = await orchestrator.executeOrdered(topology, {
      deployService: (service) =>
        deployMonorepoService(monorepoDeps, {
          service,
          parentId,
          parentName,
          config,
          trigger,
          resultByService,
        }),
      rollbackService: (service) =>
        rollbackMonorepoService(monorepoDeps, {
          service,
          trigger,
          startTime,
        }),
      waitForHealthy: async (service, deployment) => {
        if (!deployment.projectId) {
          log.warn({ serviceName: service.name }, 'Monorepo health check: no projectId — skipping');
          return { healthy: true };
        }

        const project = await this.db.getProject(deployment.projectId);
        const containerId = project
          ? (await loadServiceViewRecord(this.db, project)).view.containerId
          : null;
        if (!containerId) {
          log.warn(
            { serviceName: service.name },
            'Monorepo health check: containerId not found — skipping',
          );
          return { healthy: true };
        }

        log.info(
          { serviceName: service.name, containerId },
          'Monorepo health check: waiting for readiness',
        );

        try {
          const healthResult = await this.runtime.waitForHealthy(containerId, 20000);
          if (healthResult.healthy) {
            return { healthy: true };
          }

          log.warn(
            { serviceName: service.name, error: healthResult.error },
            'Monorepo health check: not healthy within readiness window — proceeding anyway',
          );
          return { healthy: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            { serviceName: service.name, error: message },
            'Monorepo health check: not healthy within readiness window — proceeding anyway',
          );
          return { healthy: true };
        }
      },
    });

    const childResults = buildMonorepoResults({
      services,
      parentName,
      resultByService,
      orchestration,
      startTime,
    });

    const allSuccess = orchestration.success && childResults.every((r) => r.success);
    await this.transitionProjectState(
      parentId,
      allSuccess ? 'running' : 'error',
      allSuccess ? 'deploy-success' : 'deploy-failed',
    );
    this.jobManager?.updatePhase(parentId, allSuccess ? 'done' : 'failed');

    if (allSuccess) {
      if (config.gitCredentialId) {
        const parentService = await this.db.getDeployableForProject(parentId);
        if (parentService) {
          await this.db.updateService(parentService.id, {
            gitCredentialId: config.gitCredentialId,
          });
        }
      }
      await eventBus.emit('deploy:success', {
        projectId: parentId,
        url: getProjectUrl(parentName),
        totalDurationMs: Date.now() - startTime,
        phase: 'complete',
        scope: 'parent',
        status: 'success',
        message: `Monorepo deploy complete (${String(childResults.length)} services)`,
      });
    } else {
      const failedSummary = childResults
        .filter((child) => !child.success)
        .map((child) => `${child.projectName}: ${child.error ?? 'unknown error'}`)
        .join('; ');

      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'monorepo',
        error: failedSummary || 'One or more monorepo services failed',
        phase: 'complete',
        scope: 'parent',
        status: 'failed',
        message: 'Monorepo deploy failed',
        durationMs: Date.now() - startTime,
      });
    }

    return {
      success: allSuccess,
      parentProjectId: parentId,
      parentName,
      children: childResults,
      buildDurationMs: Date.now() - startTime,
    };
  }

  private isDeployableService(service: ServiceRow): boolean {
    return !(NON_DEPLOYABLE_SERVICE_KINDS as readonly string[]).includes(service.kind);
  }

  private async resolveRedeployServiceForProject(
    project: ProjectRow,
    options?: { allowMultiServiceProjectFallback?: boolean },
  ): Promise<ServiceRow | DeployResult> {
    const candidates = new Map<string, ServiceRow>();
    const dbWithGroupLookup = this.db as Pick<Database, 'getDeployableForProject'> &
      Partial<Pick<Database, 'getDeployablesByGroup'>>;
    const groupDeployables = dbWithGroupLookup.getDeployablesByGroup
      ? await dbWithGroupLookup.getDeployablesByGroup(project.id)
      : [];
    for (const service of groupDeployables) {
      if (this.isDeployableService(service)) {
        candidates.set(service.id, service);
      }
    }

    const canonical = await this.db.getDeployableForProject(project.id);
    if (canonical && this.isDeployableService(canonical)) {
      candidates.set(canonical.id, canonical);
    }

    const deployables = [...candidates.values()];
    if (deployables.length === 0) {
      return {
        success: false,
        projectId: project.id,
        projectName: project.name,
        code: 'NO_DEPLOYABLE_SERVICE',
        error: `Project '${project.name}' has no Application/Compose workload to redeploy.`,
      };
    }
    if (deployables.length > 1) {
      if (options?.allowMultiServiceProjectFallback) {
        if (canonical && this.isDeployableService(canonical)) {
          return canonical;
        }
        const fallback = [...deployables].sort((a, b) => a.id.localeCompare(b.id))[0];
        if (fallback) return fallback;
      }
      throw new ServiceSelectionRequiredError(
        project.id,
        project.name,
        deployables.map((service) => ({
          serviceId: service.id,
          serviceName: service.name,
          kind: service.kind,
          source: service.source,
        })),
      );
    }

    return deployables[0] as ServiceRow;
  }

  private async resolveRuntimeProjectForService(
    service: ServiceRow,
  ): Promise<{ ownerProject: ProjectRow; runtimeProject: ProjectRow }> {
    const ownerProject = await this.db.getProject(service.project_id);
    if (!ownerProject) {
      throw new ProjectNotFoundError(service.project_id);
    }

    const runtimeProjectId = deployableServiceIdToProjectId(service.id);
    const runtimeProject = (await this.db.getProject(runtimeProjectId)) ?? ownerProject;
    return { ownerProject, runtimeProject };
  }

  private getServiceNetworkProjectName(
    ownerProject: ProjectRow,
    runtimeProject: ProjectRow,
  ): string {
    return ownerProject.id === runtimeProject.id ? runtimeProject.name : ownerProject.name;
  }

  private getAttachedServiceNetworkProjectName(
    ownerProject: ProjectRow,
    runtimeProject: ProjectRow,
  ): string | undefined {
    return ownerProject.id === runtimeProject.id ? undefined : ownerProject.name;
  }

  /** Compatibility wrapper. New service paths should call redeployService(serviceId). */
  async redeploy(projectId: string, options?: RedeployOptions): Promise<DeployResult> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    const service = await this.resolveRedeployServiceForProject(project, {
      allowMultiServiceProjectFallback: options?.allowMultiServiceProjectFallback,
    });
    if ('success' in service) {
      return service;
    }

    return await this.redeployResolvedService(service, options);
  }

  /** Redeploy an existing Application/Compose service by service identity. */
  async redeployService(serviceId: string, options?: RedeployOptions): Promise<DeployResult> {
    const service = await this.db.getService(serviceId);
    if (!service) {
      return {
        success: false,
        projectId: deployableServiceIdToProjectId(serviceId),
        projectName: 'unknown',
        code: 'SERVICE_NOT_FOUND',
        error: `Service not found: ${serviceId}`,
      };
    }

    const target = await resolveComposeRedeployTarget(this.db, service);
    return await this.redeployResolvedService(target.service, {
      ...options,
      ...(target.composeServices
        ? { composeServices: target.composeServices }
        : target.service.kind === 'compose'
          ? { composeServices: [] }
          : {}),
    });
  }

  async prepareStatefulComposeUpdate(
    serviceId: string,
    options?: { envVars?: Record<string, string> },
  ): Promise<StatefulComposeApproval | null> {
    const composePipeline = this.composePipeline;
    if (!composePipeline) return null;
    const requestedService = await this.db.getService(serviceId);
    if (!requestedService) throw new ServiceNotFoundError(serviceId);
    const target = await resolveComposeRedeployTarget(this.db, requestedService);
    const service = target.service;
    if (service.kind !== 'compose') return null;

    const { ownerProject, runtimeProject } = await this.resolveRuntimeProjectForService(service);
    const config = await buildDeployConfig({
      projectId: runtimeProject.id,
      serviceId: service.id,
      service,
      runtimeOverrides: {
        _projectId: runtimeProject.id,
        _serviceId: service.id,
      },
      db: this.db,
    });
    if (config.source === 'image') return null;

    const cloneResult = await cloneRepo({
      repoUrl: config.repoUrl,
      branch: config.branch,
      sshKeyPath: config.sshKeyPath,
      gitCredentialId: config.gitCredentialId,
      serviceId: service.id,
    });
    try {
      const composePaths = config.composeFiles
        ? resolveComposeFilePaths(cloneResult.path, config.composeFiles)
        : config.composeFile
          ? [resolveComposeFilePath(cloneResult.path, config.composeFile)]
          : (() => {
              const detected = composePipeline.detectComposeFile(cloneResult.path);
              return detected ? [detected] : [];
            })();
      if (composePaths.length === 0) return null;

      const parsed = composePipeline.parseComposeFiles(composePaths);
      validateComposeProfiles(parsed.services, config.composeProfiles);
      const activeServices = filterServicesByProfiles(parsed.services, config.composeProfiles);
      const runtimeRoles = inferComposeRuntimeRoles(activeServices);
      const currentFingerprints = fingerprintComposeServices(activeServices);
      const storedConfig = await this.db.loadDeployConfigForService(service.id);
      const previousFingerprints = validateStoredConfig(storedConfig?.config_json ?? '')?.snapshot
        .composeServiceFingerprints;
      const productionEnvironment = (
        await this.db.getEnvironmentsByProject(runtimeProject.id)
      ).find((environment) => environment.type === 'production');
      const baseEnv = await resolveEnvVars(
        {
          projectId: runtimeProject.id,
          serviceId: service.id,
          environmentId: productionEnvironment?.id,
          inlineEnvVars: options?.envVars,
        },
        { env: this.env },
      );
      const childServices = (await this.db.getComposeChildren(service.id)).filter(
        (child) => !child.archived_at,
      );
      if (childServices.length > 0 && Object.keys(baseEnv).length > 0) {
        const servicesWithoutEnvDeclaration = activeServices
          .filter(
            (composeService) =>
              composeService.environment === undefined &&
              (composeService.envFile?.length ?? 0) === 0,
          )
          .map((composeService) => composeService.name);
        if (servicesWithoutEnvDeclaration.length > 0) {
          throw new ComposeEnvDeclarationRequiredError(
            servicesWithoutEnvDeclaration,
            Object.keys(baseEnv).sort(),
          );
        }
      }
      const projectName = sanitizeComposeProjectName(runtimeProject.name);
      const resolvedServices = activeServices.map((composeService) => ({
        ...composeService,
        ...(composeService.image
          ? {
              image: composePipeline.resolveComposeServiceImageTag(
                composeService,
                projectName,
                baseEnv,
              ),
            }
          : {}),
      }));
      const desiredEnvByService = new Map(
        resolvedServices.map((composeService) => [
          composeService.name,
          composePipeline.resolveComposeServiceRuntimeEnv(
            composeService,
            baseEnv,
            parsed.projectPath,
          ),
        ]),
      );
      const existingServices = await Promise.all(
        childServices.map(async (child) => {
          const serviceName = composeChildServiceName(child);
          const containerId = child.container_id;
          return {
            serviceName,
            serviceId: child.id,
            runtimeRole: child.runtime_role,
            containerId,
            previousFingerprint: previousFingerprints?.[serviceName],
            ...(containerId
              ? { inspection: await this.runtime.inspectContainer(containerId) }
              : {}),
          };
        }),
      );
      const changes = classifyStatefulComposeChanges({
        projectName,
        projectPath: parsed.projectPath,
        services: resolvedServices,
        runtimeRoles,
        existingServices,
        currentFingerprints,
        desiredEnvByService,
      });
      if (changes.length === 0) return null;
      return {
        version: 1,
        serviceId: service.id,
        projectId: ownerProject.id,
        commitSha: cloneResult.commitSha,
        composeFingerprint: fingerprintComposeProject(currentFingerprints),
        changes,
      };
    } finally {
      await rm(cloneResult.path, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async executeApprovedStatefulComposeUpdate(
    approval: StatefulComposeApproval,
    options?: { noCache?: boolean; actionRunId?: string },
  ): Promise<DeployResult> {
    const current = await this.prepareStatefulComposeUpdate(approval.serviceId);
    const expectedBindings = approval.changes
      .map((change) => ({
        serviceName: change.serviceName,
        serviceId: change.serviceId,
        change: change.change,
        containerId: change.containerId,
        previousFingerprint: change.previousFingerprint,
        currentFingerprint: change.currentFingerprint,
      }))
      .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
    const currentBindings = current?.changes
      .map((change) => ({
        serviceName: change.serviceName,
        serviceId: change.serviceId,
        change: change.change,
        containerId: change.containerId,
        previousFingerprint: change.previousFingerprint,
        currentFingerprint: change.currentFingerprint,
      }))
      .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
    if (
      !current ||
      current.commitSha !== approval.commitSha ||
      current.composeFingerprint !== approval.composeFingerprint ||
      JSON.stringify(currentBindings) !== JSON.stringify(expectedBindings)
    ) {
      throw new StatefulApprovalStaleError({
        serviceId: approval.serviceId,
        expectedCommitSha: approval.commitSha,
        actualCommitSha: current?.commitSha,
      });
    }
    return await this.redeployService(approval.serviceId, {
      noCache: options?.noCache,
      strategy: 'force',
      expectedCommitSha: approval.commitSha,
      statefulComposeApproval: {
        ...approval,
        ...(options?.actionRunId ? { actionRunId: options.actionRunId } : {}),
      },
      trigger: 'api',
    });
  }

  /** Restart an existing long-running container without clone, build, or replacement. */
  async restartServiceRuntime(serviceId: string): Promise<RuntimeRestartResult> {
    const service = await this.db.getService(serviceId);
    if (!service) {
      throw new ServiceNotFoundError(serviceId);
    }
    if (service.runtime_role === 'job') {
      throw new ServiceOperationUnsupportedError('restart_service', 'job');
    }

    const { ownerProject, runtimeProject } = await this.resolveRuntimeProjectForService(service);
    await this.assertProjectMutable(ownerProject);
    if (runtimeProject.id !== ownerProject.id) {
      await this.assertProjectMutable(runtimeProject);
    }

    const containerId = service.container_id ?? runtimeProject.container_id;
    if (!containerId) {
      throw new ServiceContainerStateError(
        service.id,
        'missing',
        'The service has no existing container to restart.',
      );
    }

    return withDeployLock(
      this.db,
      { projectId: ownerProject.id, sessionId: `restart-${nanoid(12)}` },
      async () => {
        this.coordinator?.suppressProject(runtimeProject.id, 30_000);
        await this.runtime.restartContainer(containerId);
        const inspection = await this.runtime.inspectContainer(containerId);
        if (!inspection.State.Running) {
          throw new ServiceContainerStateError(
            service.id,
            'not_running',
            'Docker restart completed but the service container is not running.',
          );
        }
        await this.transitionProjectState(runtimeProject.id, 'running', 'runtime-restarted');
        if (service.status !== 'running') {
          await this.db.updateService(service.id, { status: 'running' });
        }
        return {
          status: 'restarted',
          projectId: ownerProject.id,
          serviceId: service.id,
          containerId,
        };
      },
    );
  }

  /**
   * Recreate a running service from its already-built image and the latest
   * runtime env snapshot. This is for Day-2 env/config hot paths only: no git
   * clone, no Docker build, and the existing container stays up until the
   * replacement passes readiness checks.
   */
  async recreateServiceRuntime(
    serviceId: string,
    options?: RuntimeRecreateOptions,
  ): Promise<RuntimeRecreateResult> {
    const startTime = Date.now();
    const service = await this.db.getService(serviceId);
    if (!service) {
      return {
        success: false,
        projectId: deployableServiceIdToProjectId(serviceId),
        projectName: 'unknown',
        code: 'SERVICE_NOT_FOUND',
        applyMode: 'same-image-recreate',
        error: `Service not found: ${serviceId}`,
      };
    }

    if (!this.isDeployableService(service)) {
      return {
        success: false,
        projectId: service.project_id,
        projectName: 'unknown',
        code: 'SERVICE_OPERATION_UNSUPPORTED',
        applyMode: 'same-image-recreate',
        error: `Service ${service.id} is not an Application/Compose workload.`,
      };
    }

    const { ownerProject, runtimeProject } = await this.resolveRuntimeProjectForService(service);
    const project = runtimeProject;
    const projectId = project.id;
    this.validateProjectName(project.name);

    if (ownerProject.id !== project.id) {
      await this.assertProjectMutable(ownerProject);
    }
    await this.assertProjectMutable(project);
    const networkProjectName = this.getServiceNetworkProjectName(ownerProject, project);

    const lockSession = options?.lockSessionId ?? `runtime-env-${nanoid(12)}`;
    return withDeployLock(this.db, { projectId, sessionId: lockSession }, async () => {
      const view = serviceViewFromRows(project, service);
      const imageTag = view.imageTag ?? (view.source === 'image' ? view.imageUrl : null);
      if (!imageTag) {
        return {
          success: false,
          projectId,
          projectName: project.name,
          code: 'NO_RUNTIME_IMAGE',
          applyMode: 'same-image-recreate',
          previous_version_still_serving: Boolean(view.containerId),
          error:
            'Runtime env apply requires a previously built image. Call update_app to build the service first.',
          buildDurationMs: Date.now() - startTime,
        };
      }

      let targetEnvironment = (await this.db.getEnvironmentsByProject(projectId)).find(
        (environment) => environment.type === 'production',
      );
      if (!targetEnvironment) {
        targetEnvironment = await this.db.createEnvironment({
          id: `${projectId}-production`,
          projectId,
          type: 'production',
          branch: view.source === 'image' ? null : view.branch,
        });
      }

      if (view.source === 'image') {
        try {
          await this.runtime.pullImage(imageTag);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new ImagePullError(mapPullError(err));
        }
      }

      const envVars = await resolveEnvVars(
        {
          projectId,
          serviceId: service.id,
          environmentId: targetEnvironment.id,
        },
        { env: this.env },
      );
      const secretFiles = await this.env.getSecretFilesForDeploy(projectId);
      const imageCmd = parseRuntimeImageCmd(view.imageCmdRaw);
      const exposedPort = await getImageExposedPort(this.runtime, imageTag).catch(() => null);
      let tempPort = 0;
      let tempContainerId = '';
      const tempRouteName = `${getRouteName(project.name)}-env-${nanoid(6)}`;
      const tempContainerName = projectContainerName(tempRouteName);
      const projectNetwork = await this.runtime.ensureProjectNetwork(networkProjectName);
      await ensureManagedTraefikNetwork(this.runtime, projectNetwork);
      const resourceLimits = await loadResourceLimitsForDeployTarget(this.db, {
        projectId,
        serviceId: service.id,
      });

      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          tempPort = await allocatePort(this.db, this.runtime, {}, 'production');
          const containerPort = view.containerPort ?? exposedPort ?? view.assignedPort ?? tempPort;
          try {
            tempContainerId = await this.runtime.runContainer({
              imageTag,
              name: tempContainerName,
              port: tempPort,
              containerPort,
              envVars,
              cmd: imageCmd,
              traefikLabels: {},
              network: projectNetwork,
              aliases: [tempRouteName],
              secretFiles,
              restartPolicy: { Name: 'unless-stopped' },
              labels: {
                [DOCKER_LABELS.MANAGED]: 'true',
                [DOCKER_LABELS.PROJECT]: project.name,
                [DOCKER_LABELS.SERVICE]: service.id,
                'traefik.enable': 'false',
              },
              volumeProjectName: project.name,
              resourceLimits: resourceLimits ?? undefined,
            });
            releasePortReservation(tempPort);
            break;
          } catch (error) {
            releasePortReservation(tempPort);
            const message = error instanceof Error ? error.message : String(error);
            const isPortConflict =
              message.includes('port is already allocated') ||
              message.includes('address already in use');
            if (attempt === 0 && isPortConflict) {
              clearPortScanCache();
              continue;
            }
            throw error;
          }
        }

        if (!tempContainerId) {
          throw new Error('Runtime env container recreate did not return a container id');
        }

        const healthResult = await this.runtime.waitForHealthy(
          tempContainerId,
          options?.healthCheckTimeoutMs ?? 20_000,
        );
        await eventBus.emit('monitor:healthcheck', {
          projectId,
          healthy: healthResult.healthy,
          responseTimeMs: 0,
        });
        if (!healthResult.healthy) {
          const containerLogs = await this.runtime
            .getLogs(tempContainerId, 'all')
            .catch(() => '(no logs available)');
          await this.runtime.safeRemoveContainer(tempContainerId).catch((err: unknown) => {
            log.warn(
              { err, projectId, serviceId: service.id, containerId: tempContainerId },
              'Failed to remove unhealthy replacement container after runtime env recreate',
            );
          });
          return {
            success: false,
            projectId,
            projectName: project.name,
            code: 'RUNTIME_ENV_RECREATE_FAILED',
            applyMode: 'same-image-recreate',
            readiness: 'unhealthy',
            previous_version_still_serving: Boolean(view.containerId),
            error: healthResult.error ?? 'Replacement container did not become healthy',
            buildLogTail: tailLogLines(containerLogs, 80),
            buildDurationMs: Date.now() - startTime,
          };
        }

        const previousContainerId = view.containerId;
        const previousContainerName = view.containerName;
        const containerPort = view.containerPort ?? exposedPort ?? view.assignedPort ?? tempPort;
        await this.db.updateService(service.id, {
          status: 'running',
          containerId: tempContainerId,
          containerName: tempContainerName,
          assignedPort: tempPort,
          containerPort,
          imageTag,
          previousImageTag: view.imageTag ?? null,
        });
        await this.db.updateEnvironment(targetEnvironment.id, {
          status: 'running',
          assignedPort: tempPort,
          containerId: tempContainerId,
          containerPort,
          imageTag,
          previousImageTag: view.imageTag ?? null,
        });
        await this.transitionProjectState(projectId, 'running', 'runtime-env-recreate-success', {
          containerId: tempContainerId,
          containerName: tempContainerName,
          assignedPort: tempPort,
          containerPort,
          imageTag,
          previousImageTag: view.imageTag ?? null,
        });

        const routeProbePath = explicitHealthCheckPath(view, options?.healthCheckPath);
        if (routeProbePath) {
          const routeProbe = await this.waitForManagedTraefikRoute({
            projectName: project.name,
            path: routeProbePath,
            probeTimeoutMs: options?.routeProbeTimeoutMs ?? 5_000,
            maxWaitMs: options?.routeSwitchDelayMs ?? DEFAULT_BLUE_GREEN_ROUTE_SWITCH_TIMEOUT_MS,
            intervalMs: options?.routeProbeIntervalMs ?? DEFAULT_BLUE_GREEN_ROUTE_PROBE_INTERVAL_MS,
            minimumSuccessAgeMs: Math.min(
              TRAEFIK_HTTP_PROVIDER_POLL_INTERVAL_MS,
              options?.routeSwitchDelayMs ?? DEFAULT_BLUE_GREEN_ROUTE_SWITCH_TIMEOUT_MS,
            ),
          });
          if (!routeProbe.ok) {
            const restoredStatus: ServiceRow['status'] =
              view.status === 'stopped' || view.status === 'error' || view.status === 'recovering'
                ? view.status
                : 'running';
            await this.db.updateService(service.id, {
              status: restoredStatus,
              containerId: previousContainerId,
              containerName: previousContainerName,
              assignedPort: view.assignedPort,
              containerPort: view.containerPort,
              imageTag: view.imageTag,
              previousImageTag: view.previousImageTag,
            });
            await this.db.updateEnvironment(targetEnvironment.id, {
              status: targetEnvironment.status,
              assignedPort: targetEnvironment.assigned_port,
              containerId: targetEnvironment.container_id,
              containerPort: targetEnvironment.container_port,
              imageTag: targetEnvironment.image_tag,
              previousImageTag: targetEnvironment.previous_image_tag,
            });
            await this.transitionProjectState(
              projectId,
              'running',
              'runtime-env-recreate-rollback',
              {
                containerId: previousContainerId,
                containerName: previousContainerName,
                assignedPort: view.assignedPort,
                containerPort: view.containerPort,
                imageTag: view.imageTag,
                previousImageTag: view.previousImageTag,
              },
            );
            await this.runtime.safeRemoveContainer(tempContainerId).catch((err: unknown) => {
              log.warn(
                { err, projectId, serviceId: service.id, containerId: tempContainerId },
                'Failed to remove replacement container after route verification failed',
              );
            });
            return {
              success: false,
              projectId,
              projectName: project.name,
              code: 'RUNTIME_ENV_ROUTE_VERIFY_FAILED',
              applyMode: 'same-image-recreate',
              readiness: 'unhealthy',
              route_switched: false,
              previous_version_still_serving: Boolean(previousContainerId),
              error: routeProbe.error,
              buildDurationMs: Date.now() - startTime,
            };
          }
        }

        if (previousContainerId) {
          await this.runtime.safeRemoveContainer(previousContainerId).catch((err: unknown) => {
            log.warn(
              { err, projectId, serviceId: service.id, containerId: previousContainerId },
              'Failed to remove previous container after runtime env recreate',
            );
          });
        } else if (previousContainerName) {
          await this.runtime.safeRemoveContainer(previousContainerName).catch((err: unknown) => {
            log.warn(
              { err, projectId, serviceId: service.id, containerName: previousContainerName },
              'Failed to remove previous container after runtime env recreate',
            );
          });
        }

        return {
          success: true,
          projectId,
          projectName: project.name,
          applyMode: 'same-image-recreate',
          readiness: 'healthy',
          route_switched: Boolean(routeProbePath),
          previous_version_still_serving: false,
          previousContainerId,
          previousContainerName,
          containerId: tempContainerId,
          containerName: tempContainerName,
          port: tempPort,
          url: getPreferredProjectUrl(project.name, tempPort),
          buildDurationMs: Date.now() - startTime,
        };
      } catch (error) {
        if (tempContainerId) {
          await this.runtime.safeRemoveContainer(tempContainerId).catch((err: unknown) => {
            log.warn(
              { err, projectId, serviceId: service.id, containerId: tempContainerId },
              'Failed to remove replacement container after runtime env recreate failure',
            );
          });
        } else {
          await this.runtime.safeRemoveContainer(tempContainerName).catch((err: unknown) => {
            log.debug(
              { err, projectId, serviceId: service.id, containerName: tempContainerName },
              'Replacement container cleanup skipped or failed',
            );
          });
        }
        throw error;
      }
    });
  }

  private async redeployResolvedService(
    service: ServiceRow,
    options?: RedeployOptions,
  ): Promise<DeployResult> {
    if (!this.isDeployableService(service)) {
      return {
        success: false,
        projectId: service.project_id,
        projectName: 'unknown',
        code: 'SERVICE_OPERATION_UNSUPPORTED',
        error: `Service ${service.id} is not an Application/Compose workload.`,
      };
    }

    const { ownerProject, runtimeProject } = await this.resolveRuntimeProjectForService(service);
    const projectId = runtimeProject.id;
    const project = runtimeProject;
    this.validateProjectName(project.name);

    // Pipeline boundary policy: blocks archived/recovering/circuit-open projects.
    // Throws ProjectArchivedError / ProjectRecoveringError / CircuitBreakerOpenError (409).
    if (ownerProject.id !== project.id) {
      await this.assertProjectMutable(ownerProject);
    }
    await this.assertProjectMutable(project);
    const networkProjectName = this.getAttachedServiceNetworkProjectName(ownerProject, project);

    const lockSession = options?.lockSessionId ?? nanoid(12);
    return withDeployLock(this.db, { projectId, sessionId: lockSession }, async () => {
      const redeployView = serviceViewFromRows(project, service);
      let targetEnvironment = (await this.db.getEnvironmentsByProject(projectId)).find(
        (environment) => environment.type === 'production',
      );
      if (!targetEnvironment) {
        try {
          targetEnvironment = await this.db.createEnvironment({
            id: `${projectId}-production`,
            projectId,
            type: 'production',
            branch: redeployView.source === 'image' ? null : redeployView.branch,
          });
          log.warn(
            { projectId, environmentId: targetEnvironment.id },
            'Production environment was missing during redeploy and has been recreated',
          );
        } catch (err) {
          const error =
            err instanceof Error
              ? `Production environment not found and could not be recreated: ${err.message}`
              : 'Production environment not found and could not be recreated';
          this.jobManager?.trackJob(projectId, project.name);
          await this.recordBackgroundFailure(projectId, error, options?.trigger, {
            emitTerminalEvent: true,
            attemptDeployLogWithoutServiceCheck: true,
          });
          return {
            success: false,
            projectId,
            projectName: project.name,
            error,
          };
        }
      }

      const strategy = options?.strategy ?? 'force';
      if (strategy === 'blue-green') {
        return await this.blueGreenRedeploy(projectId, {
          ...options,
          lockSessionId: lockSession,
        });
      }

      const redeployRouteName = getRouteName(project.name);
      const redeployPreviousLabel = `openlander/${redeployRouteName}:previous`;
      const redeployImageTag = redeployView.imageTag;
      const redeploySource = redeployView.source;
      const redeployAssignedPort = redeployView.assignedPort;
      const previousPort = redeployAssignedPort ?? undefined;
      const config = await buildDeployConfig({
        projectId,
        serviceId: service.id,
        service,
        runtimeOverrides: {
          _projectId: projectId,
          _serviceId: service.id,
          _preferredPort: previousPort,
          _lockSessionId: lockSession,
          _noCacheBuild: redeploySource === 'image' ? true : options?.noCache,
          _preserveLiveContainerUntilRun: true,
          environment: 'production',
          trigger: options?.trigger,
          ...(service.kind === 'compose' && options?.composeServices
            ? { composeServices: options.composeServices }
            : {}),
          ...(networkProjectName ? { _networkProjectName: networkProjectName } : {}),
          ...(options?.expectedCommitSha ? { _expectedCommitSha: options.expectedCommitSha } : {}),
          ...(options?.statefulComposeApproval
            ? { _statefulComposeApproval: options.statefulComposeApproval }
            : {}),
          ...(options?.cmd && { imageCmd: options.cmd }),
        },
        db: this.db,
      });
      if (config.source === 'image') {
        if (!config.imageUrl) {
          throw new MissingImageUrlError();
        }
        try {
          await this.runtime.pullImage(config.imageUrl);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new ImagePullError(mapPullError(err));
        }
      }
      const currentRunningTag = redeployImageTag;
      let redeployPreviousTag: string | null = currentRunningTag ?? null;
      if (redeploySource !== 'image' && currentRunningTag) {
        if (currentRunningTag !== redeployPreviousLabel) {
          try {
            await this.runtime.tagImage(
              currentRunningTag,
              `openlander/${redeployRouteName}`,
              'previous',
            );
            redeployPreviousTag = redeployPreviousLabel;
          } catch (err) {
            if (!isDockerNotFoundError(err)) {
              log.warn(
                { err, currentRunningTag },
                'Failed to preserve previous image for rollback',
              );
            }
          }
        } else {
          redeployPreviousTag = redeployPreviousLabel;
        }
      }

      await this.db.updateProject(projectId, { previousImageTag: redeployPreviousTag });
      this.jobManager?.trackJob(projectId, project.name);

      try {
        return await this.deploy(config);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.jobManager?.updatePhase(projectId, 'failed', message);
        throw error;
      }
    });
  }

  private async blueGreenRedeploy(
    projectId: string,
    options?: RedeployOptions,
  ): Promise<DeployResult> {
    // Day 12 (MAJOR #1): wrap with the same top-level lock guard as deploy().
    // Today the only caller (redeploy with strategy='blue-green') already
    // holds the lock and forwards `lockSessionId`, so this is a no-op
    // re-entry. The wrapper guarantees that any future direct entry point
    // (Day 5 design doc: "every entry point protected") cannot bypass the
    // serialization invariant.
    return this.runWithDeployLockIfTopLevel(projectId, options?.lockSessionId, (sessionId) =>
      this.blueGreenRedeployInner(projectId, { ...options, lockSessionId: sessionId }),
    );
  }

  private async blueGreenRedeployInner(
    projectId: string,
    options?: RedeployOptions,
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const healthCheckRetries =
      options?.healthCheckRetries ?? DEFAULT_BLUE_GREEN_HEALTH_CHECK_RETRIES;
    const healthCheckIntervalMs =
      options?.healthCheckIntervalMs ?? DEFAULT_BLUE_GREEN_HEALTH_CHECK_INTERVAL_MS;
    const routeSwitchDelayMs =
      options?.routeSwitchDelayMs ?? DEFAULT_BLUE_GREEN_ROUTE_SWITCH_TIMEOUT_MS;
    const routeProbeIntervalMs =
      options?.routeProbeIntervalMs ?? DEFAULT_BLUE_GREEN_ROUTE_PROBE_INTERVAL_MS;
    const routeProbeTimeoutMs = options?.routeProbeTimeoutMs ?? 5_000;
    const postSwitchStabilityMs =
      options?.postSwitchStabilityMs ?? DEFAULT_BLUE_GREEN_POST_SWITCH_STABILITY_MS;
    const postSwitchStabilityPollIntervalMs =
      options?.postSwitchStabilityPollIntervalMs ?? DEFAULT_BLUE_GREEN_STABILITY_POLL_INTERVAL_MS;
    let routeProbePath = options?.routeProbePath;
    const trigger = options?.trigger ?? 'api';

    let projectName = 'unknown';
    let imageTag: string | undefined;
    let newPort: number | undefined;
    let greenContainerId: string | undefined;
    let shouldCleanupGreen = false;
    let routeTargetUpdated = false;
    let routeSwitched = false;
    let buildLog = '';
    let clonePath: string | undefined;
    let commitSha: string | undefined;
    let blueContainerId: string | undefined;
    let environmentId: string | undefined;
    let blueState:
      | {
          containerId: string;
          containerName: string | null;
          assignedPort: number | null;
          containerPort: number | null;
          imageTag: string | null;
          previousImageTag: string | null;
        }
      | undefined;
    const warnings: string[] = [];

    try {
      const project = await this.db.getProject(projectId);
      if (!project) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project not found: ${projectId}`,
          buildDurationMs: Date.now() - startTime,
        };
      }

      projectName = project.name;
      this.validateProjectName(projectName);
      const blueRecord = await loadServiceViewRecord(this.db, project);
      const blueDeployable = blueRecord.service;
      const blueView = blueRecord.view;
      let networkProjectName = projectName;
      if (blueDeployable) {
        const { ownerProject } = await this.resolveRuntimeProjectForService(blueDeployable);
        networkProjectName = this.getServiceNetworkProjectName(ownerProject, project);
      }
      const storedHealthPath = blueDeployable
        ? explicitHealthCheckPath(blueView, options?.healthCheckPath)
        : undefined;
      routeProbePath ??= storedHealthPath ?? '/';
      const eligibility = await this.getBlueGreenEligibility(projectId, {
        healthCheckPath: options?.healthCheckPath,
      });
      if (!eligibility.supported) {
        return this.buildBlueGreenUnsupportedResult(projectId, projectName, eligibility, startTime);
      }
      if (!blueDeployable || !blueView.containerId) {
        return this.buildBlueGreenUnsupportedResult(
          projectId,
          projectName,
          {
            supported: false,
            code: 'BLUE_GREEN_UNSUPPORTED',
            reasons: ['The current service has no active container to keep serving as blue.'],
            fallback_strategy: 'force',
          },
          startTime,
        );
      }
      blueContainerId = blueView.containerId;
      blueState = {
        containerId: blueContainerId,
        containerName: blueView.containerName ?? projectContainerName(projectName),
        assignedPort: blueView.assignedPort,
        containerPort: blueView.containerPort,
        imageTag: blueView.imageTag,
        previousImageTag: blueView.previousImageTag,
      };
      await this.cleanupStaleGreenContainers({
        projectName,
        projectId,
        activeContainerId: blueContainerId,
      });

      const prodEnv = (await this.db.getEnvironmentsByProject(projectId)).find(
        (env) => env.type === 'production',
      );
      environmentId = prodEnv?.id;

      const deployConfig = await buildDeployConfig({
        projectId,
        runtimeOverrides: {
          _projectId: projectId,
          _noCacheBuild: options?.noCache,
          trigger,
        },
        db: this.db,
      });
      const imageCmd = options?.cmd ?? deployConfig.imageCmd;

      this.jobManager?.trackJob(projectId, projectName);
      await this.transitionProjectState(projectId, 'building', 'deploy-started');
      if (prodEnv) {
        await this.db.updateEnvironment(prodEnv.id, { status: 'building' });
      }

      const source: 'git' | 'image' =
        deployConfig.source === 'image' || blueView.source === 'image' ? 'image' : 'git';
      await eventBus.emit('deploy:start', { projectId, repoUrl: deployConfig.repoUrl });

      if (source === 'image') {
        const imageUrl = deployConfig.imageUrl ?? blueView.imageUrl;
        if (!imageUrl) {
          throw new MissingImageUrlError();
        }
        this.jobManager?.updatePhase(projectId, 'building');
        buildLog += `[pull] Pulling image ${imageUrl}\n`;
        try {
          await this.runtime.pullImage(imageUrl);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new ImagePullError(mapPullError(err));
        }
        buildLog += `[pull] Pulled image ${imageUrl}\n`;
        imageTag = imageUrl;
      } else {
        this.jobManager?.updatePhase(projectId, 'cloning');
        buildLog += '[clone] Cloning repository...\n';
        const cloneResult = await cloneRepo({
          repoUrl: deployConfig.repoUrl,
          branch: deployConfig.branch,
          gitCredentialId: deployConfig.gitCredentialId,
          serviceId: deployConfig._serviceId,
        });
        deployConfig.gitCredentialId = cloneResult.gitCredentialId;
        clonePath = cloneResult.path;
        commitSha = cloneResult.commitSha;
        buildLog += `[clone] Done (${cloneResult.commitSha})\n`;

        this.jobManager?.updatePhase(projectId, 'building');
        imageTag = `openlander/${projectName}:${String(Date.now())}`;
        buildLog += '[build] Building image...\n';
        const dependencyCache = createDependencyCacheKey({
          repoPath: cloneResult.path,
          commitSha: cloneResult.commitSha,
          volatileSalt: startTime,
          dependencyPaths: [deployConfig.buildContext, deployConfig.dockerfilePath],
        });
        if (dependencyCache) {
          buildLog +=
            '[build-cache] git dependency detected; refreshing dependency install layer\n';
        }

        await this.buildExecutor.build(
          {
            clonePath: cloneResult.path,
            projectId,
            imageTag,
            dockerfilePath: deployConfig.dockerfilePath,
            buildContext: deployConfig.buildContext,
            dockerTarget: deployConfig.dockerTarget,
            dependencyCacheKey: dependencyCache?.key,
            noCache: options?.noCache,
          },
          (line) => {
            buildLog += `${line}\n`;
            this.jobManager?.appendBuildOutput(projectId, line);
          },
        );
      }

      const buildDuration = Date.now() - startTime;
      buildLog += `[build] Done (${String(Math.round(buildDuration / 1000))}s)\n`;

      await eventBus.emit('deploy:build', {
        projectId,
        imageTag,
        durationMs: buildDuration,
      });

      this.jobManager?.updatePhase(projectId, 'starting');
      newPort = await allocatePort(this.db, this.runtime, {}, 'production');
      const containerPort = (await this.runtime.getImageExposedPort(imageTag)) ?? newPort;
      const envVars = await resolveEnvVars(
        { projectId, serviceId: deployConfig._serviceId ?? undefined, environmentId },
        { env: this.env },
      );
      const secretFiles = await this.env.getSecretFilesForDeploy(projectId);
      const networkName = await this.runtime.ensureProjectNetwork(networkProjectName);
      await ensureManagedTraefikNetwork(this.runtime, networkName);

      const greenName = this.makeGreenContainerName(projectName);
      const resourceLimits = await loadResourceLimitsForDeployTarget(this.db, {
        projectId,
        serviceId: deployConfig._serviceId,
      });

      greenContainerId = await this.runtime.runContainer({
        imageTag,
        name: greenName,
        port: newPort,
        containerPort,
        envVars,
        cmd: imageCmd,
        traefikLabels: { 'traefik.enable': 'false' },
        labels: this.makeGreenContainerLabels({
          projectName,
          projectId,
          serviceId: blueDeployable.id,
        }),
        network: networkName,
        aliases: [`${projectName}-green`],
        secretFiles,
        resourceLimits: resourceLimits ?? undefined,
      });
      shouldCleanupGreen = true;

      await eventBus.emit('deploy:run', {
        projectId,
        containerId: greenContainerId,
        port: newPort,
        url: getProjectUrl(projectName),
      });

      const probeProfile = resolveMonitoringProfile(project, blueDeployable);
      const probeConfig = {
        ...probeProfile.health,
        ...(options?.healthCheckPath
          ? {
              strategy: 'http' as const,
              path: this.normalizeHealthCheckPath(options.healthCheckPath),
            }
          : {}),
        failureThreshold: healthCheckRetries,
        intervalMs: healthCheckIntervalMs,
      };

      const probeContext: ProbeContext = {
        projectId: project.id,
        containerId: greenContainerId,
        assignedPort: newPort,
      };

      const probeRunner = createLocalProbeRunner(this.runtime);

      buildLog += `[health] Checking ${probeConfig.strategy} on port ${String(newPort)}${probeConfig.path ?? ''}\n`;
      const probeResult = await this.waitForBlueGreenHealth({
        probeRunner,
        config: probeConfig,
        context: probeContext,
        maxAttempts: healthCheckRetries,
        intervalMs: healthCheckIntervalMs,
      });

      if (!probeResult.healthy) {
        throw new Error(
          `Health check failed for ${projectName} on port ${String(newPort)}: ${probeResult.error ?? 'no details'}`,
        );
      }
      buildLog += `[health] Passed after ${String(probeResult.elapsedMs)}ms (${String(probeResult.attempts)} attempt(s), ${probeResult.source})\n`;

      buildLog += `[stability] Observing green container for ${String(postSwitchStabilityMs)}ms before switching route\n`;
      const stability = await this.observeBlueGreenStability({
        containerId: greenContainerId,
        observeMs: postSwitchStabilityMs,
        intervalMs: postSwitchStabilityPollIntervalMs,
      });
      if (!stability.ok) {
        buildLog += `[stability] Failed after ${String(stability.elapsedMs)}ms (${String(stability.checks)} check(s)): ${stability.error}\n`;
        shouldCleanupGreen = true;
        buildLog += '[route] Active target remained on blue after green stability failure\n';
        throw new BlueGreenStabilityError(stability.error, {
          projectId,
          greenContainerId,
          checks: stability.checks,
          elapsedMs: stability.elapsedMs,
        });
      }
      buildLog += `[stability] Passed after ${String(stability.elapsedMs)}ms (${String(stability.checks)} check(s))\n`;

      const canonicalContainerName = projectContainerName(projectName);
      buildLog += `[network] Assigning stable internal aliases to ${greenName}\n`;
      await this.runtime.disconnectContainerFromNetwork(greenContainerId, networkName);
      await this.runtime.connectContainerToNetwork(greenContainerId, networkName, [
        canonicalContainerName,
        projectName,
        `${projectName}-green`,
      ]);

      buildLog += `[route] Switching active Traefik target to ${greenName}\n`;
      await this.transitionProjectState(projectId, 'running', 'deploy-success', {
        containerId: greenContainerId,
        containerName: greenName,
        assignedPort: newPort,
        containerPort,
        imageTag,
        previousImageTag: blueState.imageTag,
      });
      if (prodEnv) {
        await this.db.updateEnvironment(prodEnv.id, {
          status: 'running',
          containerId: greenContainerId,
          assignedPort: newPort,
          containerPort,
          imageTag,
          previousImageTag: prodEnv.image_tag,
          branch: source === 'image' ? null : (deployConfig.branch ?? null),
        });
      }
      routeTargetUpdated = true;

      buildLog += `[route] Waiting up to ${String(routeSwitchDelayMs)}ms for Traefik HTTP provider polling\n`;
      const routeProbe = await this.waitForManagedTraefikRoute({
        projectName,
        path: routeProbePath,
        probeTimeoutMs: routeProbeTimeoutMs,
        maxWaitMs: routeSwitchDelayMs,
        intervalMs: routeProbeIntervalMs,
        minimumSuccessAgeMs: Math.min(TRAEFIK_HTTP_PROVIDER_POLL_INTERVAL_MS, routeSwitchDelayMs),
      });
      if (!routeProbe.ok) {
        buildLog += `[route] Failed after switch: ${routeProbe.error}\n`;
        await this.restoreBlueState({ projectId, environmentId, blue: blueState });
        routeTargetUpdated = false;
        buildLog += '[route] Rolled active target back to blue\n';
        throw new Error(routeProbe.error);
      }
      buildLog += `[route] Passed (HTTP ${String(routeProbe.status)}) after ${String(routeProbe.elapsedMs)}ms (${String(routeProbe.attempts)} attempt(s))\n`;

      try {
        await this.runtime.stopContainer(blueContainerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ err, projectId, blueContainerId }, 'Blue-green cleanup stop failed');
        throw new Error(
          `Failed to stop previous container before route cutover verification: ${message}`,
        );
      }

      buildLog += '[route] Verifying public route after blue stop\n';
      const postBlueStopRouteProbe = await this.waitForManagedTraefikRoute({
        projectName,
        path: routeProbePath,
        probeTimeoutMs: routeProbeTimeoutMs,
        maxWaitMs: routeSwitchDelayMs,
        intervalMs: routeProbeIntervalMs,
        minimumSuccessAgeMs: 0,
      });
      if (!postBlueStopRouteProbe.ok) {
        buildLog += `[route] Failed after blue stop: ${postBlueStopRouteProbe.error}\n`;
        throw new Error(
          `Route did not remain reachable after previous container stopped: ${postBlueStopRouteProbe.error}`,
        );
      }
      routeSwitched = true;
      shouldCleanupGreen = false;
      buildLog += `[route] Verified after blue stop (HTTP ${String(postBlueStopRouteProbe.status)}) after ${String(postBlueStopRouteProbe.elapsedMs)}ms (${String(postBlueStopRouteProbe.attempts)} attempt(s))\n`;

      try {
        await this.runtime.safeRemoveContainer(blueContainerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Blue cleanup warning: failed to remove previous container: ${message}`);
        log.warn({ err, projectId, blueContainerId }, 'Blue-green cleanup remove failed');
      }

      const durationMs = Date.now() - startTime;
      const projectUrl = getProjectUrl(projectName);
      if (warnings.length > 0) {
        buildLog += warnings.map((warning) => `[cleanup] ${warning}`).join('\n') + '\n';
      }

      await this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'success',
        trigger,
        commitSha,
        buildLog,
        durationMs,
      });

      if (deployConfig.gitCredentialId) {
        await this.db.updateService(deployConfig._serviceId ?? blueDeployable.id, {
          gitCredentialId: deployConfig.gitCredentialId,
        });
      }

      this.jobManager?.updatePhase(projectId, 'done');
      await eventBus.emit('deploy:success', {
        projectId,
        url: projectUrl,
        totalDurationMs: durationMs,
        sessionId: options?.lockSessionId,
      });

      return {
        success: true,
        projectId,
        projectName,
        strategy: 'blue-green',
        readiness: 'healthy',
        route_switched: true,
        previous_version_still_serving: false,
        ...(warnings.length > 0 ? { warnings } : {}),
        previousImageTag: blueState.imageTag ?? undefined,
        containerId: greenContainerId,
        url: projectUrl,
        port: newPort,
        commitSha,
        buildDurationMs: durationMs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isCancelled = isDockerBuildCancelledError(error);
      const cancelMessage = 'Build cancelled by user';
      buildLog += isCancelled ? `[cancelled] ${cancelMessage}\n` : `[error] ${errorMsg}\n`;
      const runtimeLog = isCancelled
        ? undefined
        : await this.captureContainerRuntimeLog(greenContainerId, projectId);

      if (routeTargetUpdated && !routeSwitched && blueState) {
        try {
          await this.restoreBlueState({ projectId, environmentId, blue: blueState });
          routeTargetUpdated = false;
          buildLog += '[route] Rolled active target back to blue\n';
        } catch (restoreErr) {
          buildLog += `[route] Failed to roll back active target: ${String(restoreErr)}\n`;
        }
      }

      let blueStillServing = false;
      if (blueState?.containerId) {
        try {
          const info = await this.runtime.inspectContainer(blueState.containerId);
          blueStillServing = info.State.Running;
        } catch {
          blueStillServing = false;
        }
      }

      if (!isCancelled && !blueStillServing && blueState?.containerId) {
        try {
          await this.runtime.restartContainer(blueState.containerId);
          blueStillServing = true;
          buildLog += '[recovery] Restarted blue container after failed promotion\n';
        } catch (restartErr) {
          buildLog += `[recovery] Failed to restart blue: ${String(restartErr)}\n`;
        }
      }

      if (isCancelled) {
        if (blueStillServing && blueState) {
          await this.restoreBlueState({ projectId, environmentId, blue: blueState });
        } else {
          await this.transitionProjectState(projectId, 'stopped', 'deploy-cancelled');
          if (environmentId) {
            const prodEnvCancel = await this.db.getEnvironment(environmentId);
            if (prodEnvCancel) {
              await this.db.updateEnvironment(environmentId, { status: 'stopped' });
            }
          }
        }

        const durationMs = Date.now() - startTime;
        await this.db.createDeployLog({
          id: nanoid(12),
          projectId,
          environmentId,
          status: 'cancelled',
          trigger,
          commitSha,
          buildLog,
          durationMs,
        });
        this.jobManager?.updatePhase(projectId, 'failed', cancelMessage);
        await eventBus.emit('deploy:failed', {
          projectId,
          step: 'cancelled',
          error: cancelMessage,
          buildLog,
          sessionId: options?.lockSessionId,
          cancelled: true,
          phase: 'build',
          status: 'failed',
          message: cancelMessage,
          durationMs,
        });

        return {
          success: false,
          projectId,
          projectName,
          strategy: 'blue-green',
          readiness: 'unknown',
          route_switched: false,
          previous_version_still_serving: blueStillServing,
          ...(blueStillServing
            ? { url: getProjectUrl(projectName), port: blueState?.assignedPort ?? newPort }
            : {}),
          buildDurationMs: durationMs,
          error: cancelMessage,
          cancelled: true,
        };
      }

      if (blueStillServing && blueState) {
        await this.restoreBlueState({ projectId, environmentId, blue: blueState });
        buildLog +=
          '[recovery] Previous version is still serving after failed blue-green deploy; inspect diagnostics and fix source/config before trying another update. Do not immediately retry with force.\n';
      } else {
        await this.transitionProjectState(projectId, 'error', 'deploy-runtime-error');
        if (environmentId) {
          const prodEnvErr = await this.db.getEnvironment(environmentId);
          if (prodEnvErr) {
            await this.db.updateEnvironment(environmentId, { status: 'error' });
          }
        }
      }

      await this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'failed',
        trigger,
        commitSha,
        buildLog,
        runtimeLog,
        durationMs: Date.now() - startTime,
      });

      const finalErrorMsg =
        blueStillServing && blueState
          ? `Blue-green deploy failed; previous version still serving. Inspect diagnostics and fix source/config before trying another update. Do not immediately retry with force: ${errorMsg}`
          : errorMsg;
      this.jobManager?.updatePhase(projectId, 'failed', finalErrorMsg);

      await eventBus.emit('deploy:failed', {
        projectId,
        step: 'blue-green',
        error: finalErrorMsg,
        buildLog,
        sessionId: options?.lockSessionId,
      });

      return {
        success: false,
        projectId,
        projectName,
        strategy: 'blue-green',
        readiness: 'unhealthy',
        route_switched: routeSwitched,
        previous_version_still_serving: blueStillServing,
        url: getProjectUrl(projectName),
        port: blueStillServing ? (blueState?.assignedPort ?? newPort) : newPort,
        buildDurationMs: Date.now() - startTime,
        error: finalErrorMsg,
      };
    } finally {
      if (shouldCleanupGreen && greenContainerId) {
        await this.cleanupGreenContainer(greenContainerId);
      }
      if (clonePath) {
        await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private normalizeHealthCheckPath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private async cleanupGreenContainer(containerId: string): Promise<void> {
    try {
      await this.runtime.stopContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to stop green container during cleanup');
    }

    try {
      await this.runtime.safeRemoveContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to remove green container during cleanup');
    }
  }

  private async captureProjectRuntimeLog(projectId: string): Promise<string | undefined> {
    try {
      const project = await this.db.getProject(projectId);
      const containerId = project
        ? (await loadServiceViewRecord(this.db, project)).view.containerId
        : null;
      return await this.captureContainerRuntimeLog(containerId ?? undefined, projectId);
    } catch (err) {
      log.debug({ err, projectId }, 'Failed to resolve container for runtime log capture');
      return undefined;
    }
  }

  private async captureContainerRuntimeLog(
    containerId: string | undefined,
    projectId: string,
  ): Promise<string | undefined> {
    if (!containerId) {
      return undefined;
    }
    try {
      const runtimeLog = await this.runtime.getLogs(containerId, 'all');
      return runtimeLog.length > 0 ? runtimeLog : undefined;
    } catch (err) {
      log.debug({ err, projectId, containerId }, 'Failed to capture runtime log');
      return undefined;
    }
  }

  private async cleanupStaleGreenContainers(params: {
    projectName: string;
    projectId: string;
    activeContainerId: string;
  }): Promise<void> {
    const greenNamePrefix = projectContainerName(`${params.projectName}-green-`);
    try {
      const containers = await this.runtime.listManagedContainers();
      const staleGreens = containers.filter((container) => {
        if (container.id === params.activeContainerId) return false;
        const labels = container.labels ?? {};
        const labelMatch =
          labels[BLUE_GREEN_LABELS.ROLE] === 'green' &&
          labels[BLUE_GREEN_LABELS.PROJECT_ID] === params.projectId;
        const legacyNameMatch = container.name.startsWith(greenNamePrefix);
        return labelMatch || legacyNameMatch;
      });

      for (const container of staleGreens) {
        log.info(
          { id: container.id, name: container.name, projectId: params.projectId },
          'Cleaning stale blue-green container before promotion',
        );
        await this.cleanupGreenContainer(container.id);
      }
    } catch (err) {
      log.warn(
        { err, projectId: params.projectId },
        'Failed to clean stale blue-green containers before promotion',
      );
    }
  }

  async deployPreview(options: PreviewDeployOptions): Promise<PreviewDeployResult> {
    try {
      const existing = await this.db.getProjectByName(options.previewName);
      if (existing) {
        await this.db.updateProject(existing.id, {
          parentProjectId: options.parentProjectId,
          isPreview: 1,
          prNumber: options.prNumber,
        });

        const result = await this.redeploy(existing.id, {
          trigger: 'webhook',
          allowMultiServiceProjectFallback: true,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return { success: true, url: getProjectUrl(options.previewName) };
      }

      const result = await this.deploy({
        repoUrl: options.repoUrl,
        branch: options.branch,
        name: options.previewName,
        trigger: 'webhook',
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (result.projectId) {
        await this.db.updateProject(result.projectId, {
          parentProjectId: options.parentProjectId,
          isPreview: 1,
          prNumber: options.prNumber,
        });
      }

      return { success: true, url: getProjectUrl(options.previewName) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /** Rollback a project to its previous image tag. */
  async rollback(
    projectId: string,
    environmentId?: string,
    lockSessionId?: string,
    trigger: 'chat' | 'webhook' | 'api' = 'api',
  ): Promise<DeployResult> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      // Surface missing project explicitly so callers cannot accidentally bypass
      // the mutation policy + deploy lock by referencing an archived/deleted id.
      throw new ProjectNotFoundError(projectId);
    }

    // Pipeline boundary policy: blocks archived/recovering/circuit-open projects.
    await this.assertProjectMutable(project);

    const lockSession = lockSessionId ?? nanoid(12);
    return withDeployLock(this.db, { projectId, sessionId: lockSession }, () =>
      this.rollbackExecutor.rollbackToImage(projectId, environmentId, trigger),
    );
  }

  private async forceCleanConflicts(
    projectName: string,
    error: PreflightCheckError,
  ): Promise<void> {
    const containerName = projectContainerName(projectName);

    if (!error.result.checks.nameAvailable.pass) {
      log.info({ containerName }, 'Force mode: removing conflicting container');
      await this.lifecycle.forceCleanConflicts(containerName);
    }
  }

  /** Stop a project's container. */
  async stop(projectId: string, environmentId?: string): Promise<void> {
    if (environmentId) {
      const environment = await this.db.getEnvironment(environmentId);
      if (!environment?.container_id) return;

      try {
        await this.runtime.stopContainer(environment.container_id);
      } catch (err) {
        if (!(err instanceof ContainerNotFoundError)) throw err;
      }
      await this.db.updateEnvironment(environmentId, { status: 'stopped' });
      await eventBus.emit('container:stop', { projectId, containerId: environment.container_id });
      return;
    }

    // PR 2: check compose children via services.parent_service_id.
    const childProjects = await this.db.getComposeChildProjects(projectId);
    if (childProjects.length > 0) {
      await this.lifecycle.stop(projectId);
      this.closeTunnel(projectId);
      return;
    }

    await this.lifecycle.stop(projectId);
    this.closeTunnel(projectId);
  }

  /** Start a stopped project's container. */
  async start(projectId: string, environmentId?: string): Promise<void> {
    if (environmentId) {
      const environment = await this.db.getEnvironment(environmentId);
      if (!environment?.container_id) return;

      try {
        await this.runtime.startContainer(environment.container_id);
      } catch (err) {
        if (err instanceof ContainerNotFoundError) {
          log.debug(
            { projectId, environmentId },
            'Container not found during start — may have been removed externally',
          );
        } else {
          throw err;
        }
      }
      await this.db.updateEnvironment(environmentId, { status: 'running' });
      await eventBus.emit('container:start', { projectId, containerId: environment.container_id });
      return;
    }

    await this.lifecycle.start(projectId);
  }

  /** Remove a project entirely. */
  async remove(projectId: string, cloudflare?: CloudflareTunnelManager): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) return;

    if (this.composePipeline) {
      try {
        await this.composePipeline.stopCompose(projectId);
      } catch (err) {
        log.debug({ err, projectId }, 'Compose stop during project delete skipped');
      }
    }

    const descendants = new Set<string>([projectId]);
    const queue = [projectId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      // PR 2: fetch compose children via services.parent_service_id.
      const childProjects = await this.db.getComposeChildProjects(current);
      for (const child of childProjects) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        queue.push(child.id);
      }
    }

    if (cloudflare) {
      for (const targetId of descendants) {
        const domains = await this.db.getDomainMappings(targetId);
        for (const mapping of domains) {
          try {
            await cloudflare.removeTunnel(targetId, mapping.domain);
          } catch (err) {
            log.debug(
              { err, domain: mapping.domain },
              'Domain cleanup during project delete failed — may already be removed',
            );
          }
        }
      }
    }

    await this.lifecycle.remove(projectId, this.tunnelManager);
  }

  async archive(projectId: string): Promise<void> {
    await this.lifecycle.archive(projectId, this.tunnelManager);
  }

  async archiveGroup(projectId: string): Promise<void> {
    await this.lifecycle.archiveGroup(projectId, this.tunnelManager);
  }

  async unarchive(projectId: string): Promise<void> {
    await this.lifecycle.unarchive(projectId);
  }

  async unarchiveGroup(projectId: string): Promise<void> {
    await this.lifecycle.unarchiveGroup(projectId);
  }

  /** Create a TryCloudflare tunnel for a project. */
  async exposeTunnel(projectId: string, _port: number): Promise<string> {
    return this.tunnelManager.expose(projectId, _port);
  }

  /** Close a project's tunnel. */
  closeTunnel(projectId: string): void {
    this.tunnelManager.close(projectId);
  }

  getTunnel(projectId: string): CloudflareTunnel | undefined {
    return this.tunnelManager.get(projectId);
  }

  /** Get container logs. */
  async getLogs(projectId: string, lines = 50, opts?: { timestamps?: boolean }): Promise<string> {
    return this.lifecycle.getLogs(projectId, lines, opts);
  }

  private async applyPendingFix(projectId: string, clonePath: string): Promise<string | null> {
    const rawPendingFix = await this.db.consumePendingFix(projectId);
    if (!rawPendingFix) {
      return null;
    }

    const parsed = parsePendingFix(rawPendingFix);
    if (!parsed) {
      throw new Error('Invalid pending fix payload in database');
    }

    const normalizedPath = parsed.filePath.trim().replace(/\\/g, '/');
    if (!normalizedPath || normalizedPath.startsWith('/')) {
      throw new Error('Pending fix file path must be relative');
    }

    const cloneRoot = resolve(clonePath);
    const targetPath = resolve(clonePath, normalizedPath);
    if (!targetPath.startsWith(`${cloneRoot}/`) && targetPath !== cloneRoot) {
      throw new Error('Pending fix path escaped repository root');
    }

    if (parsed.content !== undefined) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, parsed.content, 'utf8');
    } else if (parsed.patches && parsed.patches.length > 0) {
      if (!existsSync(targetPath)) {
        throw new Error(`Cannot apply patches: ${parsed.filePath} not found in repository`);
      }

      let content = readFileSync(targetPath, 'utf8');
      for (const patch of parsed.patches) {
        const regex = new RegExp(patch.pattern, patch.flags ?? 'gm');
        content = content.replace(regex, patch.replacement);
      }

      writeFileSync(targetPath, content, 'utf8');
    } else {
      throw new Error('Invalid pending fix: must have content or patches');
    }

    log.info({ projectId, filePath: normalizedPath }, 'Applied pending fix before build');
    return normalizedPath;
  }
}
