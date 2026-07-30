import { createModuleLogger } from '../lib/logger.js';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { classifyVar, parseEnvFile, formatEnvValue } from './env-inject.js';
import { isAbsolute, join, dirname, relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseDocument, type CollectionTag, type ScalarTag } from 'yaml';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { allocatePort, clearPortScanCache, releasePortReservation } from './port.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import { buildTraefikLabels, ensureManagedTraefikNetwork } from './traefik.js';
import { getCommitSubject } from './git.js';
import { getPolicy } from '../config/index.js';
import type { OpenLanderEnv } from '../config/index.js';
import { extractProjectName, composeContainerName, containerName } from './helpers.js';
import type { Docker } from './docker.js';
import type { Database, ProjectRow } from '../db/index.js';
import { acquireDeployLockOrThrow, withDeployLock } from '../db/repos/deploy-lock-helper.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../db/service-ids.js';
import type { EventBus } from '../events/index.js';
import type { ProjectStatus, StateTransitionOptions } from '../monitor/project-state-manager.js';
import type { EnvManager } from './env.js';
import type { JobManager } from './job-manager.js';
import {
  ComposeEnvDeclarationRequiredError,
  ComposeJobFailedError,
  ComposePrerequisiteUnhealthyError,
  DockerBuildError,
  InvalidTrafficServiceError,
  ServiceConfigError,
  ServiceOperationError,
  StatefulApprovalStaleError,
  TrafficServiceRequiredError,
  isDockerNotFoundError,
} from '../errors.js';
import { planComposeDeploymentSets } from './compose-deployment-sets.js';
import { assertComposeStatefulChangesSafe } from './compose-stateful-guard.js';
import {
  fingerprintComposeProject,
  type StatefulComposeApproval,
  type StatefulComposeChange,
} from './compose-stateful-update.js';
import {
  backupComposeStatefulVolumes,
  type ComposeStatefulBackupManifest,
} from './compose-stateful-backup.js';

const log = createModuleLogger('compose');

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

function getDockerBuildLog(error: unknown): string | undefined {
  if (!(error instanceof DockerBuildError)) return undefined;
  const buildLog = error.details?.['buildLog'];
  return typeof buildLog === 'string' && buildLog.trim().length > 0 ? buildLog : undefined;
}

function appendComposeError(buildLog: string, error: unknown): string {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const dockerBuildLog = getDockerBuildLog(error);
  return `${buildLog}${dockerBuildLog ? `[docker build output]\n${dockerBuildLog.trimEnd()}\n` : ''}[error] ${errorMsg}\n`;
}

interface ProjectStateTransitioner {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
}

interface PreservedStatefulContainer {
  change: StatefulComposeChange;
  originalContainerId: string;
  originalContainerName: string;
  preservedContainerName: string;
  networks: Array<{ name: string; aliases: string[] }>;
  backupManifest: ComposeStatefulBackupManifest;
}

export interface ComposeService {
  name: string;
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  ports?: string[];
  expose?: string[];
  profiles?: string[];
  environment?: Record<string, string> | string[];
  envFile?: ComposeEnvFile[];
  dependsOn?: string[];
  dependsOnConditions?: Record<string, ComposeDependencyCondition>;
  volumes?: string[];
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  memoryLimitBytes?: number;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
}

export type ComposeRuntimeRole = 'application' | 'job' | 'resource';

function composeChildServiceName(name: string, parentName: string): string {
  const prefix = `${parentName}/`;
  return (name.startsWith(prefix) ? name.slice(prefix.length) : name).replace(/__svc$/, '');
}

const RESOURCE_SIGNATURES: ReadonlyArray<{ pattern: RegExp; port: number }> = [
  { pattern: /(?:postgres|pgvector)/i, port: 5432 },
  { pattern: /(?:mysql|mariadb)/i, port: 3306 },
  { pattern: /redis/i, port: 6379 },
  { pattern: /mongo/i, port: 27017 },
  { pattern: /rabbitmq/i, port: 5672 },
  { pattern: /minio/i, port: 9000 },
];

export function inferComposeRuntimeRoles(
  services: readonly ComposeService[],
): Map<string, ComposeRuntimeRole> {
  const jobs = new Set<string>();
  for (const service of services) {
    for (const dependency of service.dependsOn ?? []) {
      if (service.dependsOnConditions?.[dependency] === 'service_completed_successfully') {
        jobs.add(dependency);
      }
    }
  }

  return new Map(
    services.map((service) => {
      if (jobs.has(service.name)) return [service.name, 'job'] as const;
      const signature = `${service.name} ${service.image ?? ''}`;
      const role = RESOURCE_SIGNATURES.some(({ pattern }) => pattern.test(signature))
        ? 'resource'
        : 'application';
      return [service.name, role] as const;
    }),
  );
}

export function knownComposeResourcePort(service: ComposeService): number | null {
  const signature = `${service.name} ${service.image ?? ''}`;
  return RESOURCE_SIGNATURES.find(({ pattern }) => pattern.test(signature))?.port ?? null;
}

export type ComposeDependencyCondition =
  'service_started' | 'service_healthy' | 'service_completed_successfully';

export interface ComposeEnvFile {
  path: string;
  required: boolean;
}

export interface ComposeProject {
  services: ComposeService[];
  composePath: string;
  composePaths?: string[];
  projectPath: string;
}

export interface ComposeHostPortUsage {
  service: string;
  ports: string[];
}

export interface ComposeDeployConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha?: string;
  composePath: string;
  composePaths?: string[];
  profiles?: string[];
  services?: string[];
  name?: string;
  envVars?: Record<string, string>;
  trigger?: 'chat' | 'webhook' | 'api';
  environmentType?: OpenLanderEnv;
  _parentId?: string;
  /** @internal Deploy lock session owned by an outer deploy orchestration. */
  _lockSessionId?: string;
  /** @internal Preserve first-deploy validation after the lock wrapper creates the parent row. */
  _parentCreatedForDeploy?: boolean;
  gitCredentialId?: string;
  trafficService?: string;
  previousServiceFingerprints?: Record<string, string>;
  noCache?: boolean;
  sourceRevisionChanged?: boolean;
  statefulApproval?: StatefulComposeApproval;
  networkProjectName?: string;
}

interface ComposeResetValue {
  readonly __openlanderComposeReset: true;
  readonly value: unknown;
}

const composeResetScalarTag: ScalarTag = {
  tag: '!reset',
  resolve: (value) => ({
    __openlanderComposeReset: true,
    value: value === 'null' ? null : value,
  }),
};

const composeResetSequenceTag: CollectionTag = {
  tag: '!reset',
  collection: 'seq',
  resolve: () => ({ __openlanderComposeReset: true, value: [] }),
};

const composeResetMapTag: CollectionTag = {
  tag: '!reset',
  collection: 'map',
  resolve: () => ({ __openlanderComposeReset: true, value: {} }),
};

function isComposeResetValue(value: unknown): value is ComposeResetValue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['__openlanderComposeReset'] === true
  );
}

function mergeComposeValues(
  base: unknown,
  overlay: unknown,
  path: readonly string[] = [],
): unknown {
  if (isComposeResetValue(overlay)) {
    return overlay.value;
  }

  if (Array.isArray(base) && Array.isArray(overlay)) {
    const key = path.at(-1);
    if (
      key === 'command' ||
      key === 'entrypoint' ||
      path.slice(-2).join('.') === 'healthcheck.test'
    ) {
      return overlay;
    }
    const mergedValues: unknown[] = [...(base as unknown[]), ...(overlay as unknown[])];
    return mergedValues.filter(
      (value, index, values) => values.findIndex((candidate) => candidate === value) === index,
    );
  }

  if (
    base &&
    overlay &&
    typeof base === 'object' &&
    typeof overlay === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(overlay)
  ) {
    const merged = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
      merged[key] = mergeComposeValues(merged[key], value, [...path, key]);
    }
    return merged;
  }

  return overlay;
}

function parseComposeDocument(composePath: string): Record<string, unknown> {
  const document = parseDocument(readFileSync(composePath, 'utf8'), {
    merge: true,
    customTags: [composeResetScalarTag, composeResetSequenceTag, composeResetMapTag],
  });
  if (document.errors.length > 0) {
    throw new ServiceConfigError('Invalid Compose YAML.', {
      parserCode: document.errors[0]?.code ?? 'YAML_PARSE_FAILED',
    });
  }
  const parsed = document.toJS() as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * Filters compose services based on active profiles.
 * Services without profiles are always included.
 */
export function filterServicesByProfiles(
  services: ComposeService[],
  activeProfiles?: string[],
): ComposeService[] {
  const resolvedProfiles = activeProfiles ?? [];
  const includedServices = services.filter((service) => {
    if (!service.profiles || service.profiles.length === 0) {
      return true;
    }
    return service.profiles.some((profile) => resolvedProfiles.includes(profile));
  });

  const keptNames = new Set(includedServices.map((service) => service.name));

  return includedServices.map((service) => {
    if (!service.dependsOn) {
      return service;
    }

    return {
      ...service,
      dependsOn: service.dependsOn.filter((dependency) => keptNames.has(dependency)),
      dependsOnConditions: service.dependsOnConditions
        ? Object.fromEntries(
            Object.entries(service.dependsOnConditions).filter(([dependency]) =>
              keptNames.has(dependency),
            ),
          )
        : undefined,
    };
  });
}

export function validateComposeProfiles(
  services: readonly ComposeService[],
  activeProfiles?: readonly string[],
): void {
  const resolvedProfiles = activeProfiles ?? [];
  const availableProfiles = new Set(services.flatMap((service) => service.profiles ?? []));
  const unknownProfiles = resolvedProfiles.filter((profile) => !availableProfiles.has(profile));
  if (unknownProfiles.length > 0) {
    throw new ServiceConfigError(`Unknown Compose profile(s): ${unknownProfiles.join(', ')}`, {
      requested: resolvedProfiles,
      available: [...availableProfiles].sort(),
    });
  }
}

function normalizeComposeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeComposeFingerprintValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeComposeFingerprintValue(entry)]),
  );
}

/** Hash normalized service definitions without persisting env/secret plaintext. */
export function fingerprintComposeServices(
  services: readonly ComposeService[],
): Record<string, string> {
  return Object.fromEntries(
    services.map((service) => [
      service.name,
      createHash('sha256')
        .update(JSON.stringify(normalizeComposeFingerprintValue(service)))
        .digest('hex'),
    ]),
  );
}

/**
 * Selects requested services together with their transitive dependencies.
 * This mirrors `docker compose up service...` instead of producing a broken
 * topology with missing `depends_on` targets.
 */
export function selectComposeServices(
  services: ComposeService[],
  requested?: string[],
): ComposeService[] {
  if (!requested || requested.length === 0) {
    return services;
  }

  const byName = new Map(services.map((service) => [service.name, service]));
  const unknown = requested.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    throw new ServiceConfigError(`Unknown Compose service(s): ${unknown.join(', ')}`, {
      requested,
      available: services.map((service) => service.name),
    });
  }

  const selected = new Set<string>();
  const visit = (name: string): void => {
    if (selected.has(name)) return;
    const service = byName.get(name);
    if (!service) return;
    selected.add(name);
    for (const dependency of service.dependsOn ?? []) {
      visit(dependency);
    }
  };
  for (const name of requested) visit(name);

  return services.filter((service) => selected.has(service.name));
}

export function findComposeHostPortUsages(composeProject: ComposeProject): ComposeHostPortUsage[] {
  return composeProject.services
    .map((service) => ({
      service: service.name,
      ports: (service.ports ?? []).filter((port) => {
        const withoutProtocol = port.trim().split('/')[0] ?? '';
        return withoutProtocol.split(':').length > 1;
      }),
    }))
    .filter((usage) => usage.ports.length > 0);
}

/** Infer an application's internal HTTP port from a localhost healthcheck. */
export function inferComposeHealthcheckPort(service: ComposeService): number | undefined {
  const test = service.healthcheck?.test;
  const command = Array.isArray(test) ? test.join(' ') : test;
  if (!command) {
    return undefined;
  }
  const match = command.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})/i);
  const port = match?.[1] ? Number(match[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

export interface ComposeDeployResult {
  success: boolean;
  parentProjectId: string;
  parentName: string;
  services: ComposeServiceStatus[];
  buildDurationMs: number;
  error?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
  trafficService?: string;
  trafficServiceProjectId?: string;
  trafficServicePort?: number;
  warnings?: string[];
  serviceFingerprints?: Record<string, string>;
}

export interface ComposeServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  ports?: string[];
  containerId?: string;
  /**
   * Populated when the service is in a partial state (still running but
   * orchestration rollback was blocked by policy or failed). Lets UI /
   * monorepo result building distinguish "fully healthy" from
   * "running but orchestration partially failed".
   */
  error?: string;
}

export interface EnvFileReferenceError {
  service: string;
  envFilePath: string;
  requiredVars: string[];
  templatePath: string | null;
}

export function sanitizeComposeProjectName(name: string): string {
  return name
    .replace(/\//g, '-')
    .replace(/[^a-z0-9_-]/gi, '')
    .toLowerCase();
}

function isDockerEndpointConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('endpoint with name') && message.includes('already exists in network');
}

export class ComposePipeline {
  private stateManager?: ProjectStateTransitioner;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly jobManager?: JobManager,
    private readonly env?: EnvManager,
    private readonly routeProvider: 'docker-labels' | 'http-provider' = 'docker-labels',
  ) {}

  setStateManager(stateManager: ProjectStateTransitioner): void {
    this.stateManager = stateManager;
  }

  private async transitionProjectStatus(
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
  ): Promise<void> {
    if (this.stateManager) {
      await this.stateManager.transition(projectId, targetStatus, reason);
      return;
    }

    await this.db.updateProject(projectId, { status: targetStatus });
  }

  private composeNetworkNames(projectNetwork: string | null, envType: OpenLanderEnv): string[] {
    return Array.from(
      new Set(
        [projectNetwork, getPolicy(envType).networkName].filter((name): name is string =>
          Boolean(name),
        ),
      ),
    );
  }

  private async cleanupComposeContainer(
    containerRef: string,
    networkNames: string[],
    reason: string,
  ): Promise<void> {
    for (const networkName of networkNames) {
      try {
        await this.docker.disconnectContainerFromNetwork(containerRef, networkName);
      } catch (error) {
        log.debug(
          { err: error, containerRef, networkName, reason },
          'Failed to disconnect compose container from network during cleanup',
        );
      }
    }

    try {
      await this.docker.safeRemoveContainer(containerRef);
    } catch (error) {
      log.debug(
        { err: error, containerRef, reason },
        'Failed to remove compose container during cleanup',
      );
    }
  }

  private composeContainerNetworks(
    inspection: Awaited<ReturnType<Docker['inspectContainer']>>,
  ): Array<{ name: string; aliases: string[] }> {
    return Object.entries(inspection.NetworkSettings.Networks).map(([name, settings]) => ({
      name,
      aliases: Array.isArray(settings.Aliases)
        ? settings.Aliases.filter((alias): alias is string => typeof alias === 'string')
        : [],
    }));
  }

  private async assertContainerNameAvailable(containerName: string): Promise<void> {
    try {
      const existing = await this.docker.inspectContainer(containerName);
      throw new ServiceOperationError(
        'stateful_compose_preserve',
        `Cannot preserve the Stateful Compose container because '${containerName}' is already in use.`,
        { containerId: existing.Id, containerName },
      );
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  private async restorePreservedStatefulContainer(
    preserved: PreservedStatefulContainer,
    childProjectId: string,
  ): Promise<void> {
    try {
      const conflicting = await this.docker.inspectContainer(preserved.originalContainerName);
      if (conflicting.Id !== preserved.originalContainerId) {
        await this.cleanupComposeContainer(
          conflicting.Id,
          preserved.networks.map((network) => network.name),
          'stateful-compose-restore-new-container',
        );
      }
    } catch (error) {
      if (!isDockerNotFoundError(error)) throw error;
    }

    await this.docker.renameContainer(
      preserved.originalContainerId,
      preserved.originalContainerName,
    );
    for (const network of preserved.networks) {
      await this.docker.connectContainerToNetwork(
        preserved.originalContainerId,
        network.name,
        network.aliases,
      );
    }
    await this.docker.startContainer(preserved.originalContainerId);
    await this.db.updateProject(childProjectId, {
      status: 'running',
      containerId: preserved.originalContainerId,
      containerName: preserved.originalContainerName,
    });
  }

  private async prepareApprovedStatefulSwap(params: {
    change: StatefulComposeChange;
    containerName: string;
    actionRunId: string;
  }): Promise<PreservedStatefulContainer> {
    const inspection = await this.docker.inspectContainer(params.change.containerId);
    if (inspection.Id !== params.change.containerId) {
      throw new StatefulApprovalStaleError({
        reason: 'container_changed',
        serviceName: params.change.serviceName,
      });
    }

    const preservedContainerName = sanitizeComposeProjectName(
      `${params.containerName}-preserved-${params.actionRunId.slice(0, 12)}`,
    );
    await this.assertContainerNameAvailable(preservedContainerName);
    const networks = this.composeContainerNetworks(inspection);
    let renamed = false;

    try {
      await this.docker.stopContainer(params.change.containerId);
      const backupManifest = await backupComposeStatefulVolumes({
        runtime: this.docker,
        actionRunId: params.actionRunId,
        serviceId: params.change.serviceId,
        serviceName: params.change.serviceName,
        containerId: params.change.containerId,
        volumes: params.change.backupVolumes,
      });
      await this.docker.renameContainer(params.change.containerId, preservedContainerName);
      renamed = true;
      for (const network of networks) {
        await this.docker.disconnectContainerFromNetwork(params.change.containerId, network.name);
      }
      return {
        change: params.change,
        originalContainerId: params.change.containerId,
        originalContainerName: params.containerName,
        preservedContainerName,
        networks,
        backupManifest,
      };
    } catch (error) {
      if (renamed) {
        await this.docker.renameContainer(params.change.containerId, params.containerName);
      }
      for (const network of networks) {
        await this.docker.connectContainerToNetwork(
          params.change.containerId,
          network.name,
          network.aliases,
        );
      }
      await this.docker.startContainer(params.change.containerId);
      throw error;
    }
  }

  private async archiveApprovedStatefulRemoval(params: {
    change: StatefulComposeChange;
    parentName: string;
    actionRunId: string;
  }): Promise<PreservedStatefulContainer> {
    const childProjectId = deployableServiceIdToProjectId(params.change.serviceId);
    const containerName = composeContainerName(params.parentName, params.change.serviceName);
    const preserved = await this.prepareApprovedStatefulSwap({
      change: params.change,
      containerName,
      actionRunId: params.actionRunId,
    });
    const archivedAt = new Date().toISOString();
    try {
      await this.db.setProjectArchivedAt(childProjectId, archivedAt);
      await this.db.updateService(params.change.serviceId, {
        archivedAt,
        status: 'stopped',
        containerId: preserved.originalContainerId,
        containerName: preserved.preservedContainerName,
        assignedPort: null,
      });
      return preserved;
    } catch (error) {
      await this.restorePreservedStatefulContainer(preserved, childProjectId);
      throw error;
    }
  }

  private async unarchiveApprovedStatefulRemoval(
    preserved: PreservedStatefulContainer,
  ): Promise<void> {
    const childProjectId = deployableServiceIdToProjectId(preserved.change.serviceId);
    await this.db.setProjectArchivedAt(childProjectId, null);
    await this.db.updateService(preserved.change.serviceId, { archivedAt: null });
    await this.restorePreservedStatefulContainer(preserved, childProjectId);
  }

  detectComposeFile(projectPath: string): string | null {
    for (const filename of COMPOSE_FILES) {
      const fullPath = join(projectPath, filename);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * Check env_file references in docker-compose services.
   * If providedVars are available and an env_file is missing, create it.
   * Returns error info for any missing env files that could NOT be created.
   */
  checkEnvFileReferences(
    composeProject: ComposeProject,
    providedVars: Record<string, string>,
  ): EnvFileReferenceError[] {
    const errors: EnvFileReferenceError[] = [];
    const { projectPath } = composeProject;

    for (const service of composeProject.services) {
      if (!service.envFile) continue;

      for (const envFileRef of service.envFile) {
        const envFilePath = envFileRef.path;
        const fullPath = join(projectPath, envFilePath);

        // Already exists — nothing to do
        if (existsSync(fullPath)) {
          continue;
        }

        if (!envFileRef.required) {
          continue;
        }

        // Look for template file in same directory
        const envDir = dirname(fullPath);
        let templatePath: string | null = null;
        const templateNames = ['.env.example', '.env.sample', '.env.template'];
        for (const templateName of templateNames) {
          const candidate = join(envDir, templateName);
          if (existsSync(candidate)) {
            templatePath = candidate;
            break;
          }
        }

        // Try to create the missing env file from providedVars and/or template
        if (Object.keys(providedVars).length > 0 || templatePath) {
          const envLines: string[] = [];
          const usedKeys = new Set<string>();

          // Start from template if available — merge with providedVars
          if (templatePath) {
            const templateVars = parseEnvFile(templatePath);
            for (const [key, templateValue] of templateVars.entries()) {
              usedKeys.add(key);
              const value = providedVars[key] ?? templateValue;
              const classification = classifyVar(key, templateValue);
              if (classification === 'secret' && providedVars[key] === undefined) {
                envLines.push(`# TODO: Set ${key}`);
                envLines.push(`${key}=`);
              } else {
                envLines.push(`${key}=${formatEnvValue(value)}`);
              }
            }
          }

          // Append any providedVars not already covered by template
          for (const [key, value] of Object.entries(providedVars)) {
            if (usedKeys.has(key)) continue;
            envLines.push(`${key}=${formatEnvValue(value)}`);
          }

          // Write the file
          mkdirSync(envDir, { recursive: true });
          writeFileSync(fullPath, envLines.join('\n') + '\n', 'utf8');
          log.info(
            { envFilePath: fullPath, fromTemplate: !!templatePath, varCount: envLines.length },
            'Created missing env_file from provided vars',
          );
          continue;
        }

        // No providedVars and no template — cannot auto-create
        let requiredVars: string[] = [];
        if (templatePath) {
          const templateVars = parseEnvFile(templatePath);
          requiredVars = Array.from(templateVars.keys());
        }

        errors.push({
          service: service.name,
          envFilePath,
          requiredVars,
          templatePath,
        });
      }
    }

    return errors;
  }
  parseComposeFile(composePath: string): ComposeProject {
    return this.parseComposeFiles([composePath]);
  }

  parseComposeFiles(composePaths: readonly string[]): ComposeProject {
    const composePath = composePaths[0];
    if (!composePath) {
      throw new ServiceConfigError('At least one Compose file is required.');
    }
    const parsed = composePaths
      .map((path) => parseComposeDocument(path))
      .reduce<Record<string, unknown>>(
        (merged, overlay) => mergeComposeValues(merged, overlay) as Record<string, unknown>,
        {},
      );
    const servicesRaw = parsed['services'];

    if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
      return {
        services: [],
        composePath,
        composePaths: [...composePaths],
        projectPath: dirname(composePath),
      };
    }

    const services: ComposeService[] = [];

    for (const [name, value] of Object.entries(servicesRaw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        services.push({ name });
        continue;
      }

      const serviceObj = value as Record<string, unknown>;
      const buildRaw = serviceObj['build'];
      const environmentRaw = serviceObj['environment'];
      const dependsOnRaw = serviceObj['depends_on'];

      let build: ComposeService['build'];
      if (typeof buildRaw === 'string') {
        build = buildRaw;
      } else if (buildRaw && typeof buildRaw === 'object' && !Array.isArray(buildRaw)) {
        const buildObj = buildRaw as Record<string, unknown>;
        const context = buildObj['context'];
        if (typeof context === 'string') {
          const dockerfile = buildObj['dockerfile'];
          build = {
            context,
            dockerfile: typeof dockerfile === 'string' ? dockerfile : undefined,
          };
        }
      }

      let environment: ComposeService['environment'];
      if (Array.isArray(environmentRaw)) {
        environment = environmentRaw.map((item) => String(item));
      } else if (environmentRaw && typeof environmentRaw === 'object') {
        const envObj: Record<string, string> = {};
        for (const [key, envValue] of Object.entries(environmentRaw as Record<string, unknown>)) {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          envObj[key] = envValue == null ? '' : String(envValue);
        }
        environment = envObj;
      }

      let dependsOn: string[] | undefined;
      let dependsOnConditions: Record<string, ComposeDependencyCondition> | undefined;
      if (Array.isArray(dependsOnRaw)) {
        dependsOn = dependsOnRaw.map((dep) => String(dep));
      } else if (dependsOnRaw && typeof dependsOnRaw === 'object') {
        dependsOn = Object.keys(dependsOnRaw);
        dependsOnConditions = {};
        for (const [dependency, rawConfig] of Object.entries(
          dependsOnRaw as Record<string, unknown>,
        )) {
          if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
            continue;
          }
          const condition = (rawConfig as Record<string, unknown>)['condition'];
          if (
            condition === 'service_started' ||
            condition === 'service_healthy' ||
            condition === 'service_completed_successfully'
          ) {
            dependsOnConditions[dependency] = condition;
          }
        }
        if (Object.keys(dependsOnConditions).length === 0) {
          dependsOnConditions = undefined;
        }
      }

      const portsRaw = serviceObj['ports'];
      const exposeRaw = serviceObj['expose'];
      const volumesRaw = serviceObj['volumes'];
      const imageRaw = serviceObj['image'];
      const envFileRaw = serviceObj['env_file'];
      const profilesRaw = serviceObj['profiles'];
      const commandRaw = serviceObj['command'];
      const entrypointRaw = serviceObj['entrypoint'];
      const restartRaw = serviceObj['restart'];
      const healthcheckRaw = serviceObj['healthcheck'];
      const memoryLimitRaw = serviceObj['mem_limit'];

      let command: ComposeService['command'];
      if (typeof commandRaw === 'string') {
        command = commandRaw;
      } else if (Array.isArray(commandRaw)) {
        command = commandRaw.map((item) => String(item));
      }

      let entrypoint: ComposeService['entrypoint'];
      if (typeof entrypointRaw === 'string') {
        entrypoint = entrypointRaw;
      } else if (Array.isArray(entrypointRaw)) {
        entrypoint = entrypointRaw.map((item) => String(item));
      }

      let restart: string | undefined;
      if (typeof restartRaw === 'string') {
        restart = restartRaw;
      }

      let healthcheck: ComposeService['healthcheck'] | undefined;
      if (healthcheckRaw && typeof healthcheckRaw === 'object' && !Array.isArray(healthcheckRaw)) {
        const hcObj = healthcheckRaw as Record<string, unknown>;
        const testRaw = hcObj['test'];
        let test: string | string[] | undefined;
        if (typeof testRaw === 'string') {
          test = testRaw;
        } else if (Array.isArray(testRaw)) {
          test = testRaw.map((item) => String(item));
        }
        if (test) {
          healthcheck = {
            test,
            interval: typeof hcObj['interval'] === 'string' ? hcObj['interval'] : undefined,
            timeout: typeof hcObj['timeout'] === 'string' ? hcObj['timeout'] : undefined,
            retries:
              typeof hcObj['retries'] === 'number'
                ? hcObj['retries']
                : typeof hcObj['retries'] === 'string'
                  ? parseInt(hcObj['retries'], 10)
                  : undefined,
            start_period:
              typeof hcObj['start_period'] === 'string' ? hcObj['start_period'] : undefined,
          };
        }
      }

      let envFile: ComposeEnvFile[] | undefined;
      if (typeof envFileRaw === 'string') {
        envFile = [{ path: envFileRaw, required: true }];
      } else if (Array.isArray(envFileRaw)) {
        envFile = envFileRaw
          .map((entry): ComposeEnvFile | null => {
            if (typeof entry === 'string') {
              return { path: entry, required: true };
            }
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
              const item = entry as Record<string, unknown>;
              const path = item['path'];
              if (typeof path !== 'string') {
                return null;
              }
              const required = typeof item['required'] === 'boolean' ? item['required'] : true;
              return { path, required };
            }
            return null;
          })
          .filter((entry): entry is ComposeEnvFile => entry !== null);
      } else if (envFileRaw && typeof envFileRaw === 'object' && !Array.isArray(envFileRaw)) {
        const item = envFileRaw as Record<string, unknown>;
        const path = item['path'];
        if (typeof path === 'string') {
          const required = typeof item['required'] === 'boolean' ? item['required'] : true;
          envFile = [{ path, required }];
        }
      }

      let profiles: string[] | undefined;
      if (typeof profilesRaw === 'string') {
        profiles = [profilesRaw];
      } else if (Array.isArray(profilesRaw)) {
        profiles = profilesRaw.map((profile) => String(profile));
      }

      services.push({
        name,
        image: typeof imageRaw === 'string' ? imageRaw : undefined,
        build,
        ports: Array.isArray(portsRaw)
          ? portsRaw.map((port) => formatComposePortValue(port)).filter((port) => port.length > 0)
          : undefined,
        expose: normalizeComposeStringList(exposeRaw),
        profiles,
        environment,
        envFile,
        dependsOn,
        dependsOnConditions,
        volumes: Array.isArray(volumesRaw) ? volumesRaw.map((volume) => String(volume)) : undefined,
        command,
        entrypoint,
        restart,
        memoryLimitBytes: parseComposeByteValue(memoryLimitRaw),
        healthcheck,
      });
    }

    return {
      services,
      composePath,
      composePaths: [...composePaths],
      projectPath: dirname(composePath),
    };
  }

  async startComposeDeploy(config: ComposeDeployConfig): Promise<{
    parentProjectId: string;
    parentName: string;
    status: 'building';
  }> {
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const parentProjectId = nanoid(12);
    this.validateComposeInterpolation(
      this.filteredComposeProjectForConfig(config),
      config.envVars ?? {},
    );

    await this.db.createProject({
      id: parentProjectId,
      name: parentName,
      repoUrl: config.repoUrl,
      branch: config.branch,
      dockerfilePath: relative(config.clonePath, config.composePath),
      buildMethod: 'compose',
    });
    await this.db.updateProject(parentProjectId, {
      status: 'building',
      dockerfilePath: relative(config.clonePath, config.composePath),
      buildMethod: 'compose',
    });
    this.jobManager?.trackJob(parentProjectId, parentName);

    const lockSessionId = `compose-${nanoid(12)}`;
    await acquireDeployLockOrThrow(this.db, {
      projectId: parentProjectId,
      sessionId: lockSessionId,
    });

    void this.deployCompose({
      ...config,
      name: parentName,
      _parentId: parentProjectId,
      _lockSessionId: lockSessionId,
    })
      .finally(async () => {
        await this.db.releaseDeployLock(parentProjectId, lockSessionId);
      })
      .catch((error: unknown) => {
        log.error({ err: error, parentProjectId }, 'Background compose deploy failed');
      });

    return { parentProjectId, parentName, status: 'building' };
  }

  async deployCompose(config: ComposeDeployConfig): Promise<ComposeDeployResult> {
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    let parentProjectId = config._parentId;

    if (!parentProjectId) {
      parentProjectId = nanoid(12);
      await this.db.createProject({
        id: parentProjectId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
        dockerfilePath: relative(config.clonePath, config.composePath),
        buildMethod: 'compose',
      });
      this.jobManager?.trackJob(parentProjectId, parentName);
    }

    const lockedConfig = {
      ...config,
      name: parentName,
      _parentId: parentProjectId,
      ...(!config._parentId ? { _parentCreatedForDeploy: true } : {}),
    };
    if (config._lockSessionId) {
      return this.deployComposeViaDockerode(lockedConfig);
    }

    const lockSessionId = `compose-${nanoid(12)}`;
    return withDeployLock(this.db, { projectId: parentProjectId, sessionId: lockSessionId }, () =>
      this.deployComposeViaDockerode({
        ...lockedConfig,
        _lockSessionId: lockSessionId,
      }),
    );
  }

  async deployComposeViaDockerode(config: ComposeDeployConfig): Promise<ComposeDeployResult> {
    const startTime = Date.now();
    const trigger = config.trigger ?? 'api';
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const projectName = sanitizeComposeProjectName(parentName);
    const parentProjectId = config._parentId ?? nanoid(12);
    const envType: OpenLanderEnv = config.environmentType ?? 'production';
    let buildLog = '';
    const buildLogsByService = new Map<string, string>();
    const runtimeLogsByService = new Map<string, string>();
    const commitMessage = await getCommitSubject(config.clonePath, config.commitSha);

    const composeProject = this.parseComposeFiles(config.composePaths ?? [config.composePath]);
    validateComposeProfiles(composeProject.services, config.profiles);
    const activeComposeProject: ComposeProject = {
      ...composeProject,
      services: filterServicesByProfiles(composeProject.services, config.profiles),
    };
    // Validate requested names before computing dependency semantics. The
    // selected set also scopes declaration checks; an unselected reverse
    // proxy must not block a targeted OpenLander deployment.
    const selectedComposeServices = selectComposeServices(
      activeComposeProject.services,
      config.services,
    );
    const runtimeRoles = inferComposeRuntimeRoles(activeComposeProject.services);
    const allExistingChildren = await this.db.getComposeChildProjects(parentProjectId);
    const allExistingChildServices = await this.db.getComposeChildren(`${parentProjectId}__svc`);
    const existingChildren = allExistingChildren.filter((child) => !child.archived_at);
    const existingChildServices = allExistingChildServices.filter((child) => !child.archived_at);
    const envVars = { ...(config.envVars ?? {}) };
    if (existingChildren.length > 0 && Object.keys(envVars).length > 0) {
      const servicesWithoutEnvDeclaration = selectedComposeServices
        .filter(
          (service) => service.environment === undefined && (service.envFile?.length ?? 0) === 0,
        )
        .map((service) => service.name);
      if (servicesWithoutEnvDeclaration.length > 0) {
        throw new ComposeEnvDeclarationRequiredError(
          servicesWithoutEnvDeclaration,
          Object.keys(envVars).sort(),
        );
      }
    }
    const existingByName = new Map(existingChildren.map((child) => [child.name, child]));
    const existingServiceNames = new Set(
      existingChildren.flatMap((child) => {
        const prefix = `${parentName}/`;
        return child.name.startsWith(prefix) ? [child.name.slice(prefix.length)] : [];
      }),
    );
    const currentServiceFingerprints = fingerprintComposeServices(activeComposeProject.services);
    const approvedChanges = new Map(
      config.statefulApproval?.changes.map((change) => [change.serviceName, change.change]) ?? [],
    );
    if (config.statefulApproval) {
      const staleDetails: Record<string, unknown> = {};
      if (config.commitSha !== config.statefulApproval.commitSha) {
        staleDetails['expectedCommitSha'] = config.statefulApproval.commitSha;
        staleDetails['actualCommitSha'] = config.commitSha;
      }
      const actualComposeFingerprint = fingerprintComposeProject(currentServiceFingerprints);
      if (actualComposeFingerprint !== config.statefulApproval.composeFingerprint) {
        staleDetails['expectedComposeFingerprint'] = config.statefulApproval.composeFingerprint;
        staleDetails['actualComposeFingerprint'] = actualComposeFingerprint;
      }
      const existingChildById = new Map(existingChildServices.map((child) => [child.id, child]));
      const staleContainers = config.statefulApproval.changes.flatMap((change) => {
        const child = existingChildById.get(change.serviceId);
        return child?.container_id === change.containerId ? [] : [change.serviceName];
      });
      if (staleContainers.length > 0) staleDetails['staleContainers'] = staleContainers;
      if (Object.keys(staleDetails).length > 0) {
        throw new StatefulApprovalStaleError(staleDetails);
      }
    }
    const inferredExistingRuntimeRoles = inferComposeRuntimeRoles(
      existingChildren.map((child) => ({
        name: composeChildServiceName(child.name, parentName),
        image: child.image_tag ?? undefined,
      })),
    );
    assertComposeStatefulChangesSafe({
      currentServiceNames: new Set(activeComposeProject.services.map((service) => service.name)),
      currentRuntimeRoles: runtimeRoles,
      existingServices: existingChildServices.map((service) => ({
        name: composeChildServiceName(service.name, parentName),
        runtimeRole:
          service.runtime_role === 'resource'
            ? service.runtime_role
            : (inferredExistingRuntimeRoles.get(
                composeChildServiceName(service.name, parentName),
              ) ?? service.runtime_role),
      })),
      previousFingerprints: config.previousServiceFingerprints,
      currentFingerprints: currentServiceFingerprints,
      approvedChanges,
    });
    const deploymentSets = planComposeDeploymentSets({
      services: activeComposeProject.services,
      runtimeRoles,
      selectedServices: config.services,
      existingServices: existingServiceNames,
      previousFingerprints: config.previousServiceFingerprints,
      currentFingerprints: currentServiceFingerprints,
      forceReplaceApplications: config.noCache === true || config.sourceRevisionChanged === true,
      statefulReplaceTargets: new Set(
        config.statefulApproval?.changes
          .filter((change) => change.change === 'update')
          .map((change) => change.serviceName) ?? [],
      ),
    });
    if (config.noCache === true || config.sourceRevisionChanged === true) {
      const reasons = [
        ...(config.sourceRevisionChanged === true ? ['source-revision'] : []),
        ...(config.noCache === true ? ['no-cache'] : []),
      ];
      buildLog += `[compose rebuild] ${reasons.join(',')}\n`;
    }
    const filteredComposeProject: ComposeProject = {
      ...activeComposeProject,
      services: activeComposeProject.services
        .filter((service) => deploymentSets.includedServices.has(service.name))
        .map((service) => ({
          ...service,
          dependsOn: service.dependsOn?.filter((dependency) =>
            deploymentSets.includedServices.has(dependency),
          ),
          dependsOnConditions: service.dependsOnConditions
            ? Object.fromEntries(
                Object.entries(service.dependsOnConditions).filter(([dependency]) =>
                  deploymentSets.includedServices.has(dependency),
                ),
              )
            : undefined,
        })),
    };
    // Representative traffic belongs to the whole Compose project, not only
    // the subset being replaced. A selective API deploy must preserve a
    // persisted web traffic target even though web is outside the execution set.
    const trafficCandidates = activeComposeProject.services
      .filter(
        (service) =>
          runtimeRoles.get(service.name) === 'application' &&
          ((service.ports?.length ?? 0) > 0 ||
            (service.expose?.length ?? 0) > 0 ||
            inferComposeHealthcheckPort(service) !== undefined),
      )
      .map((service) => service.name);
    if (config.trafficService && !trafficCandidates.includes(config.trafficService)) {
      throw new InvalidTrafficServiceError(config.trafficService, trafficCandidates);
    }
    const trafficService =
      config.trafficService ?? (trafficCandidates.length === 1 ? trafficCandidates[0] : undefined);
    const warnings: string[] = [];
    if (!trafficService && trafficCandidates.length > 1) {
      if (!config._parentId || config._parentCreatedForDeploy) {
        throw new TrafficServiceRequiredError(trafficCandidates);
      }
      warnings.push('traffic_target_unresolved');
    }

    this.validateComposeInterpolation(filteredComposeProject, envVars);

    const envFileErrors = this.checkEnvFileReferences(filteredComposeProject, envVars);
    if (envFileErrors.length > 0) {
      const errorMessages = envFileErrors.map((err) => {
        let msg = `env_file '${err.envFilePath}' referenced by service '${err.service}' not found`;
        if (err.templatePath) {
          const relativeTemplate = err.templatePath
            .replace(filteredComposeProject.projectPath, '')
            .replace(/^\//, '');
          msg += `. Template '${relativeTemplate}' defines variables: ${err.requiredVars.join(', ')}`;
        } else {
          msg += '. Please provide required environment variables.';
        }
        return msg;
      });
      throw new Error(`Missing env_file(s) in docker-compose:\n${errorMessages.join('\n')}`);
    }

    // A selective deploy may intentionally exclude a one-shot job or an unrelated
    // application from the runtime execution set. Keep every existing child aligned
    // with the active Compose specification so observation does not retain legacy
    // roles, ports, or health strategies for services that were not restarted.
    for (const service of activeComposeProject.services) {
      const existing = existingByName.get(`${parentName}/${service.name}`);
      if (!existing) continue;
      const runtimeRole = runtimeRoles.get(service.name) ?? 'application';
      const declaredContainerPorts = this.resolveServiceContainerPorts(service, envVars);
      const internalContainerPort =
        runtimeRole === 'job'
          ? null
          : (declaredContainerPorts[0] ??
            (runtimeRole === 'resource' ? knownComposeResourcePort(service) : null));
      await this.db.updateProject(existing.id, {
        runtimeRole,
        containerName: composeContainerName(parentName, service.name),
        assignedPort: runtimeRole === 'application' ? existing.assigned_port : null,
        containerPort: internalContainerPort,
        healthCheckStrategy:
          runtimeRole === 'job'
            ? 'none'
            : runtimeRole === 'resource'
              ? service.healthcheck
                ? 'exec'
                : internalContainerPort
                  ? 'tcp'
                  : 'none'
              : internalContainerPort
                ? 'http'
                : 'none',
      });
    }

    if (!config._parentId) {
      await this.db.createProject({
        id: parentProjectId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
        dockerfilePath: relative(config.clonePath, config.composePath),
        buildMethod: 'compose',
      });
      this.jobManager?.trackJob(parentProjectId, parentName);
    }

    await this.db.updateProject(parentProjectId, {
      status: 'building',
      dockerfilePath: relative(config.clonePath, config.composePath),
      buildMethod: 'compose',
    });

    const childrenByService = new Map<string, string>();
    for (const child of existingChildren) {
      const prefix = `${parentName}/`;
      if (child.name.startsWith(prefix)) {
        childrenByService.set(child.name.slice(prefix.length), child.id);
      }
    }

    for (const service of filteredComposeProject.services) {
      const childName = `${parentName}/${service.name}`;
      const existing = existingByName.get(childName);

      let childId: string;
      if (existing) {
        childId = existing.id;
      } else {
        childId = nanoid(12);
        await this.db.createProject({
          id: childId,
          name: childName,
          repoUrl: config.repoUrl,
          branch: config.branch,
          parentProjectId,
        });
      }

      childrenByService.set(service.name, childId);
      await this.db.updateProject(childId, {
        runtimeRole: runtimeRoles.get(service.name) ?? 'application',
      });
      const isExistingPrerequisite =
        deploymentSets.prerequisites.has(service.name) && Boolean(existing?.container_id);
      if (!isExistingPrerequisite) {
        await this.transitionProjectStatus(childId, 'building', 'compose-build-start');
        this.jobManager?.trackJob(childId, childName);
      }
    }

    // Persist compose `depends_on` into project_dependencies so the
    // topology endpoint surfaces edges between sibling services. The
    // table is otherwise only populated by managed-DB connect actions,
    // which leaves compose stacks edge-less in the InfraMap.
    //
    // Idempotent across redeploys: clear the source-side deps first,
    // then re-insert from the freshly parsed compose graph. Targets
    // outside this compose project are skipped (we can only resolve
    // service-name → child-id within the current stack).
    for (const composeService of filteredComposeProject.services) {
      const sourceChildId = childrenByService.get(composeService.name);
      if (!sourceChildId) continue;
      await this.db.deleteProjectDependenciesByProject(sourceChildId);
      for (const depName of composeService.dependsOn ?? []) {
        const targetChildId = childrenByService.get(depName);
        if (!targetChildId) continue;
        try {
          await this.db.createProjectDependency({
            source_project_id: sourceChildId,
            target_project_id: targetChildId,
            dependency_type: 'custom',
            source: 'auto',
          });
        } catch (error) {
          log.debug(
            { err: error, sourceChildId, targetChildId },
            'Skipped duplicate compose dependency edge',
          );
          // best-effort — duplicate / FK race shouldn't fail the deploy
        }
      }
    }

    const deployOnlyActive = Boolean(config.services && config.services.length > 0);
    if (!deployOnlyActive) {
      const composeServiceNames = new Set(
        activeComposeProject.services.map((service) => service.name),
      );
      const orphanChildren = existingChildren
        .map((child) => {
          const prefix = `${parentName}/`;
          if (!child.name.startsWith(prefix)) {
            return null;
          }

          const serviceName = child.name.slice(prefix.length);
          if (
            serviceName.length === 0 ||
            composeServiceNames.has(serviceName) ||
            approvedChanges.get(serviceName) === 'remove'
          ) {
            return null;
          }

          return { child, serviceName };
        })
        .filter((entry): entry is { child: ProjectRow; serviceName: string } => entry !== null);

      if (orphanChildren.length > 0) {
        const removed: string[] = [];
        log.warn(
          {
            projectId: parentProjectId,
            removed: orphanChildren.map((entry) => entry.serviceName),
          },
          'Detected orphan compose child projects; cleaning up',
        );

        for (const { child, serviceName } of orphanChildren) {
          if (child.container_id) {
            try {
              await this.docker.stopContainer(child.container_id);
            } catch (err) {
              if (!isDockerNotFoundError(err)) {
                throw err;
              }
            }
            await this.docker.safeRemoveContainer(child.container_id);
          }

          // Hard delete intentional: orphaned compose children are not user-created projects and should not be archived.
          // Also explicitly delete the backing services row: compose-child service rows have
          // project_id = parentProjectId (not child.id), so the FK cascade on deleteProject
          // does NOT reach them. The __svc convention is established in createProject().
          await this.db.deleteService(`${child.id}__svc`);
          await this.db.deleteProject(child.id);
          removed.push(serviceName);
        }

        await this.events.emit('compose:orphans-cleaned', {
          projectId: parentProjectId,
          removed,
        });
      }
    }

    await this.events.emit('compose:start', {
      projectId: parentProjectId,
      composePath: config.composePath,
      serviceCount: filteredComposeProject.services.length,
    });

    const serviceByName = new Map(
      filteredComposeProject.services.map((service) => [service.name, service]),
    );
    const deploymentByService = new Map<
      string,
      {
        containerId: string;
        ports: Array<{ hostPort: number; containerPort: number }>;
      }
    >();
    const containerNameByService = new Map<string, string>();
    const reusedServiceNames = new Set<string>();
    const createdDeploymentServiceNames = new Set<string>();
    const preparedImageTags = new Map<string, string>();
    const existingReplacementByService = new Map(
      [...deploymentSets.replaceTargets].flatMap((serviceName) => {
        const existing = existingByName.get(`${parentName}/${serviceName}`);
        return existing?.container_id ? [[serviceName, existing] as const] : [];
      }),
    );
    const statefulSwaps = new Map<string, PreservedStatefulContainer>();
    const restoredStatefulServiceNames = new Set<string>();
    const archivedStatefulRemovals = new Map<string, PreservedStatefulContainer>();
    let projectNetwork: string | null = null;
    const sharedSecretFiles = this.env
      ? await this.env.getSecretFilesForDeploy(parentProjectId)
      : [];

    try {
      this.jobManager?.updatePhase(parentProjectId, 'building');

      projectNetwork = await this.docker.ensureProjectNetwork(
        config.networkProjectName ?? projectName,
      );
      const activeProjectNetwork = projectNetwork;
      await ensureManagedTraefikNetwork(this.docker, activeProjectNetwork);
      const services: ServiceNode[] = filteredComposeProject.services.map((service) => {
        return {
          name: service.name,
          composePath: config.composePath,
          dependsOn: service.dependsOn ?? [],
          envVars,
        };
      });

      const orchestrator = new DeployOrchestrator(this.events);
      const topology = orchestrator.buildTopology(
        services,
        config.repoUrl,
        config.clonePath,
        'compose',
        config.branch,
      );
      const topologyValidation = orchestrator.validateTopology(topology, []);
      if (!topologyValidation.valid) {
        throw new Error(
          `Compose topology validation failed: ${topologyValidation.errors.join('; ')}`,
        );
      }

      const servicesRequiringSuccessfulCompletion = new Set<string>();
      const completedServiceNames = new Set<string>();
      const jobFailures = new Map<string, ComposeJobFailedError>();
      const prerequisiteFailures = new Map<string, ComposePrerequisiteUnhealthyError>();
      const appendComposeBuildOutput = (
        serviceName: string,
        output: { stream?: string; error?: string },
      ): void => {
        const chunk = [output.stream, output.error ? `ERROR: ${output.error}\n` : undefined]
          .filter((value): value is string => Boolean(value))
          .join('');
        if (!chunk) return;
        buildLog += chunk;
        buildLogsByService.set(serviceName, `${buildLogsByService.get(serviceName) ?? ''}${chunk}`);
        this.jobManager?.appendBuildOutput(parentProjectId, chunk);
        const childId = childrenByService.get(serviceName);
        if (childId) this.jobManager?.appendBuildOutput(childId, chunk);
      };
      for (const service of topology.services) {
        for (const dependency of service.dependsOn) {
          if (
            serviceByName.get(service.name)?.dependsOnConditions?.[dependency] ===
            'service_completed_successfully'
          ) {
            servicesRequiringSuccessfulCompletion.add(dependency);
          }
        }
      }

      // Build replacement images before running release hooks. Existing
      // application containers and routes remain active during this phase.
      for (const serviceName of deploymentSets.replaceTargets) {
        const composeService = serviceByName.get(serviceName);
        if (!composeService) continue;
        const imageTag = this.resolveComposeServiceImageTag(composeService, projectName, envVars);
        if (composeService.build) {
          const { contextPath, dockerfile } = this.resolveBuildContext(
            filteredComposeProject.projectPath,
            composeService,
          );
          buildLog += `[compose build ${serviceName}] ${contextPath}\n`;
          buildLogsByService.set(
            serviceName,
            `${buildLogsByService.get(serviceName) ?? ''}[compose build ${serviceName}] ${contextPath}\n`,
          );
          await this.docker.buildComposeService({
            contextPath,
            dockerfile,
            tag: imageTag,
            cacheFrom: [imageTag],
            noCache: config.noCache === true,
            onProgress: (output) => {
              appendComposeBuildOutput(serviceName, output);
            },
          });
        } else {
          buildLog += `[compose pull ${serviceName}] ${imageTag}\n`;
          buildLogsByService.set(serviceName, `[compose pull ${serviceName}] ${imageTag}\n`);
          await this.docker.pullImage(imageTag);
        }
        preparedImageTags.set(serviceName, imageTag);
      }

      for (const change of config.statefulApproval?.changes ?? []) {
        if (change.change !== 'remove') continue;
        const preserved = await this.archiveApprovedStatefulRemoval({
          change,
          parentName,
          actionRunId: config.statefulApproval?.actionRunId ?? 'approved-stateful-update',
        });
        archivedStatefulRemovals.set(change.serviceName, preserved);
        buildLog += `[stateful archive ${change.serviceName}] backup=${preserved.backupManifest.manifestPath}\n`;
      }

      for (const service of filteredComposeProject.services) {
        const childName = `${parentName}/${service.name}`;
        const existing = existingByName.get(childName);
        const reusesExistingPrerequisite =
          deploymentSets.prerequisites.has(service.name) && Boolean(existing?.container_id);
        if (reusesExistingPrerequisite || deploymentSets.replaceTargets.has(service.name)) continue;
        const staleContainerName = composeContainerName(parentName, service.name);
        await this.cleanupComposeContainer(
          staleContainerName,
          this.composeNetworkNames(projectNetwork, envType),
          'pre-compose-service-start',
        );
      }

      const orchestration = await orchestrator.executeOrdered(topology, {
        deployService: async (service) => {
          const composeService = serviceByName.get(service.name);
          if (!composeService) {
            return {
              success: false,
              projectId: childrenByService.get(service.name),
              error: `Service ${service.name} not found in compose project`,
            };
          }

          const childId = childrenByService.get(service.name);
          if (!childId) {
            return {
              success: false,
              error: `Child project not found for service ${service.name}`,
            };
          }

          const containerName = composeContainerName(parentName, service.name);
          containerNameByService.set(service.name, containerName);
          const runtimeRole = runtimeRoles.get(service.name) ?? 'application';

          if (deploymentSets.prerequisites.has(service.name)) {
            const existing = existingByName.get(`${parentName}/${service.name}`);
            if (existing?.container_id) {
              try {
                const inspected = await this.docker.inspectContainer(existing.container_id);
                if (!inspected.State.Running) {
                  await this.docker.startContainer(existing.container_id);
                }
                const hostPort = existing.assigned_port;
                const containerPort = existing.container_port;
                deploymentByService.set(service.name, {
                  containerId: existing.container_id,
                  ports:
                    hostPort != null && containerPort != null ? [{ hostPort, containerPort }] : [],
                });
                containerNameByService.set(
                  service.name,
                  composeContainerName(parentName, service.name),
                );
                reusedServiceNames.add(service.name);
                await this.db.updateProject(childId, { status: 'running' });
                buildLog += `[compose reuse ${service.name}] ${existing.container_id.slice(0, 12)}\n`;
                return { success: true, projectId: childId };
              } catch (error) {
                if (!isDockerNotFoundError(error)) {
                  const reason = error instanceof Error ? error.message : String(error);
                  const prerequisiteError = new ComposePrerequisiteUnhealthyError(
                    service.name,
                    reason,
                  );
                  prerequisiteFailures.set(service.name, prerequisiteError);
                  return {
                    success: false,
                    projectId: childId,
                    error: prerequisiteError.message,
                  };
                }
                // The database row is stale. A missing prerequisite may be
                // created, but an existing unhealthy resource is never removed.
              }
            }
          }

          let allocatedPortMappings: Array<{ hostPort: number; containerPort: number }> = [];

          try {
            this.jobManager?.updatePhase(childId, 'building');

            const preparedImageTag = preparedImageTags.get(service.name);
            const imageTag =
              preparedImageTag ??
              this.resolveComposeServiceImageTag(composeService, projectName, envVars);
            if (!preparedImageTag) {
              if (composeService.build) {
                const { contextPath, dockerfile } = this.resolveBuildContext(
                  filteredComposeProject.projectPath,
                  composeService,
                );
                buildLog += `[compose build ${service.name}] ${contextPath}\n`;
                buildLogsByService.set(
                  service.name,
                  `${buildLogsByService.get(service.name) ?? ''}[compose build ${service.name}] ${contextPath}\n`,
                );
                await this.docker.buildComposeService({
                  contextPath,
                  dockerfile,
                  tag: imageTag,
                  cacheFrom: [imageTag],
                  noCache: config.noCache === true,
                  onProgress: (output) => {
                    appendComposeBuildOutput(service.name, output);
                  },
                });
              } else {
                buildLog += `[compose pull ${service.name}] ${imageTag}\n`;
                buildLogsByService.set(
                  service.name,
                  `[compose pull ${service.name}] ${imageTag}\n`,
                );
                await this.docker.pullImage(imageTag);
              }
            }

            this.jobManager?.updatePhase(childId, 'starting');
            const approvedStatefulChange = config.statefulApproval?.changes.find(
              (change) => change.serviceName === service.name && change.change === 'update',
            );
            if (approvedStatefulChange) {
              const preserved = await this.prepareApprovedStatefulSwap({
                change: approvedStatefulChange,
                containerName,
                actionRunId: config.statefulApproval?.actionRunId ?? 'approved-stateful-update',
              });
              statefulSwaps.set(service.name, preserved);
              buildLog += `[stateful backup ${service.name}] ${preserved.backupManifest.manifestPath}\n`;
            } else {
              await this.cleanupComposeContainer(
                containerName,
                this.composeNetworkNames(projectNetwork, envType),
                'compose-service-replace',
              );
            }

            const declaredContainerPorts = this.resolveServiceContainerPorts(
              composeService,
              envVars,
            );
            const shouldExposeApplication =
              runtimeRole === 'application' && declaredContainerPorts.length > 0;
            let portMappings = shouldExposeApplication
              ? await this.allocateComposePortMappings(composeService, envVars, envType)
              : [];
            allocatedPortMappings = portMappings;
            let primaryPort = portMappings[0];
            const internalContainerPort =
              runtimeRole === 'job'
                ? null
                : (primaryPort?.containerPort ??
                  declaredContainerPorts[0] ??
                  (runtimeRole === 'resource' ? knownComposeResourcePort(composeService) : null));
            const routeName = sanitizeComposeProjectName(`${projectName}-${service.name}`);
            const traefikLabels = primaryPort
              ? buildTraefikLabels(
                  routeName,
                  primaryPort.containerPort,
                  undefined,
                  envType,
                  activeProjectNetwork,
                  this.routeProvider,
                )
              : {};
            const resolvedEnvVars = this.resolveComposeServiceRuntimeEnv(
              composeService,
              envVars,
              filteredComposeProject.projectPath,
            );
            const healthcheck = this.resolveDockerHealthcheck(composeService.healthcheck);

            const { binds: extraBinds, fileCopies } = await this.resolveComposeServiceMounts(
              projectName,
              composeService,
              filteredComposeProject.projectPath,
              envVars,
              imageTag,
            );
            let containerId: string | null = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                containerId = await this.docker.runComposeService({
                  imageTag,
                  name: containerName,
                  ...(primaryPort
                    ? {
                        port: primaryPort.hostPort,
                        containerPort: primaryPort.containerPort,
                      }
                    : internalContainerPort
                      ? {
                          containerPort: internalContainerPort,
                          exposedPorts: [internalContainerPort],
                        }
                      : {}),
                  additionalPorts: portMappings.slice(1),
                  envVars: resolvedEnvVars,
                  traefikLabels,
                  secretFiles: sharedSecretFiles,
                  command: composeService.command,
                  entrypoint: composeService.entrypoint,
                  restart: runtimeRole === 'job' ? 'no' : composeService.restart,
                  healthcheck,
                  networks: [activeProjectNetwork],
                  aliases: [service.name],
                  extraBinds,
                  fileCopies,
                  memoryLimitBytes: composeService.memoryLimitBytes,
                });
                break;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const isPortConflict =
                  message.includes('port is already allocated') ||
                  message.includes('address already in use');
                if (attempt === 0 && isPortConflict) {
                  for (const mapping of portMappings) {
                    releasePortReservation(mapping.hostPort);
                  }
                  clearPortScanCache();
                  portMappings = await this.allocateComposePortMappings(
                    composeService,
                    envVars,
                    envType,
                  );
                  primaryPort = portMappings[0];
                  if (!primaryPort) {
                    throw new Error(
                      `Failed to re-allocate a port for Compose service ${service.name}`,
                    );
                  }
                  allocatedPortMappings = portMappings;
                  continue;
                }
                if (attempt === 0 && isDockerEndpointConflictError(error)) {
                  await this.cleanupComposeContainer(
                    containerName,
                    this.composeNetworkNames(projectNetwork, envType),
                    'compose-endpoint-conflict-retry',
                  );
                  continue;
                }
                throw error;
              }
            }

            if (!containerId) {
              throw new Error(`Failed to start compose service ${service.name}`);
            }

            deploymentByService.set(service.name, {
              containerId,
              ports: portMappings,
            });
            createdDeploymentServiceNames.add(service.name);

            await this.db.updateProject(childId, {
              status: 'running',
              containerId,
              containerName,
              assignedPort: primaryPort?.hostPort ?? null,
              containerPort: internalContainerPort,
              imageTag,
              runtimeRole,
              healthCheckStrategy:
                runtimeRole === 'job'
                  ? 'none'
                  : runtimeRole === 'resource'
                    ? composeService.healthcheck
                      ? 'exec'
                      : internalContainerPort
                        ? 'tcp'
                        : 'none'
                    : primaryPort
                      ? 'http'
                      : 'none',
            });

            // Release reservation AFTER the DB write so subsequent allocatePort
            // calls within the same deploy see the port as used (via DB scan)
            // and do not re-allocate it to another service.
            for (const mapping of portMappings) {
              releasePortReservation(mapping.hostPort);
            }
            allocatedPortMappings = [];
            this.jobManager?.updatePhase(childId, 'done');
            buildLog += `[compose run ${service.name}] ${containerId.slice(0, 12)} ${portMappings.map((mapping) => `${String(mapping.hostPort)}:${String(mapping.containerPort)}`).join(', ')}\n`;

            return {
              success: true,
              projectId: childId,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            for (const mapping of allocatedPortMappings) {
              releasePortReservation(mapping.hostPort);
            }

            await this.cleanupComposeContainer(
              containerName,
              this.composeNetworkNames(projectNetwork, envType),
              'compose-service-start-failure',
            );

            const preservedStateful = statefulSwaps.get(service.name);
            if (preservedStateful) {
              await this.restorePreservedStatefulContainer(preservedStateful, childId);
              statefulSwaps.delete(service.name);
              restoredStatefulServiceNames.add(service.name);
              deploymentByService.delete(service.name);
              createdDeploymentServiceNames.delete(service.name);
              containerNameByService.delete(service.name);
            }

            await this.db.updateProject(childId, {
              status: preservedStateful ? 'running' : 'error',
            });
            this.jobManager?.updatePhase(childId, 'failed', errorMsg);
            buildLog = appendComposeError(buildLog, error);
            buildLog += `[compose error ${service.name}] ${errorMsg}\n`;

            return {
              success: false,
              projectId: childId,
              error: errorMsg,
            };
          }
        },
        waitForHealthy: async (service) => {
          const deployment = deploymentByService.get(service.name);
          if (!deployment) {
            return {
              healthy: false,
              error: `Service ${service.name} deployment metadata missing`,
            };
          }

          if (
            runtimeRoles.get(service.name) === 'job' ||
            servicesRequiringSuccessfulCompletion.has(service.name)
          ) {
            const completion = await this.waitForComposeJob(deployment.containerId, 120_000);
            const runtimeOutput = await this.docker
              .getLogs(deployment.containerId, 'all')
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                log.warn(
                  { err: error, serviceName: service.name, containerId: deployment.containerId },
                  'Failed to capture Compose job output',
                );
                return `[log capture failed] ${message}`;
              });
            runtimeLogsByService.set(
              service.name,
              `[compose job ${service.name}] exit_code=${String(completion.exitCode ?? 'unknown')}\n--- stdout/stderr ---\n${runtimeOutput}`,
            );
            if (completion.healthy) {
              completedServiceNames.add(service.name);
            } else {
              jobFailures.set(
                service.name,
                new ComposeJobFailedError(service.name, completion.exitCode, completion.error),
              );
            }
            return completion;
          }

          const composeService = serviceByName.get(service.name);
          const healthResult = await this.docker.waitForHealthy(
            deployment.containerId,
            this.resolveComposeHealthTimeoutMs(composeService?.healthcheck),
          );
          if (healthResult.healthy) {
            return { healthy: true };
          }

          if (deploymentSets.prerequisites.has(service.name)) {
            const prerequisiteError = new ComposePrerequisiteUnhealthyError(
              service.name,
              healthResult.error,
            );
            prerequisiteFailures.set(service.name, prerequisiteError);
            return { healthy: false, error: prerequisiteError.message };
          }

          return {
            healthy: false,
            error: healthResult.error ?? `Service ${service.name} failed its health check`,
          };
        },
        rollbackService: async (service) => {
          if (reusedServiceNames.has(service.name)) {
            return;
          }
          const deployment = deploymentByService.get(service.name);
          const containerName = containerNameByService.get(service.name);
          const childId = childrenByService.get(service.name);
          const preservedStateful = statefulSwaps.get(service.name);

          if (deployment) {
            try {
              await this.docker.stopContainer(deployment.containerId);
            } catch (error) {
              if (!isDockerNotFoundError(error)) {
                throw error;
              }
            }
            await this.cleanupComposeContainer(
              deployment.containerId,
              this.composeNetworkNames(projectNetwork, envType),
              'compose-rollback-deployed-service',
            );
            for (const mapping of deployment.ports) {
              releasePortReservation(mapping.hostPort);
            }
          } else if (containerName) {
            try {
              await this.docker.stopContainer(containerName);
            } catch (error) {
              if (!isDockerNotFoundError(error)) {
                throw error;
              }
            }
            await this.cleanupComposeContainer(
              containerName,
              this.composeNetworkNames(projectNetwork, envType),
              'compose-rollback-container-name',
            );
          }

          if (preservedStateful && childId) {
            await this.restorePreservedStatefulContainer(preservedStateful, childId);
            statefulSwaps.delete(service.name);
            restoredStatefulServiceNames.add(service.name);
            deploymentByService.delete(service.name);
            this.jobManager?.updatePhase(
              childId,
              'failed',
              'Restored the previous Stateful Compose container after deployment failure',
            );
            return;
          }

          if (childId) {
            await this.db.updateProject(childId, {
              status: 'error',
              containerId: null,
              assignedPort: null,
            });
            this.jobManager?.updatePhase(
              childId,
              'failed',
              'Rolled back due to compose dependency deployment failure',
            );
          }

          deploymentByService.delete(service.name);
        },
      });

      const orchestrationByService = new Map(
        orchestration.services.map((service) => [service.name, service]),
      );
      const reconciledStatuses = filteredComposeProject.services.map((service) => {
        const deployment = deploymentByService.get(service.name);
        const orchestrationEntry = orchestrationByService.get(service.name);
        const orchestrationStatus = orchestrationEntry?.status;

        if (restoredStatefulServiceNames.has(service.name)) {
          const previous = existingByName.get(`${parentName}/${service.name}`);
          return {
            name: service.name,
            status: 'running' as const,
            ports:
              previous?.assigned_port != null && previous.container_port != null
                ? [`${String(previous.assigned_port)}:${String(previous.container_port)}`]
                : [],
            containerId: previous?.container_id ?? undefined,
            ...(orchestrationEntry?.error ? { error: orchestrationEntry.error } : {}),
          };
        }

        if (deployment && reusedServiceNames.has(service.name)) {
          return {
            name: service.name,
            status: orchestrationStatus === 'failed' ? ('error' as const) : ('running' as const),
            ports: deployment.ports.map(
              (mapping) => `${String(mapping.hostPort)}:${String(mapping.containerPort)}`,
            ),
            containerId: deployment.containerId,
            ...(orchestrationEntry?.error ? { error: orchestrationEntry.error } : {}),
          };
        }

        const preservedExisting = existingByName.get(`${parentName}/${service.name}`);
        if (preservedExisting?.container_id && !createdDeploymentServiceNames.has(service.name)) {
          const ports =
            preservedExisting.assigned_port != null && preservedExisting.container_port != null
              ? [
                  `${String(preservedExisting.assigned_port)}:${String(
                    preservedExisting.container_port,
                  )}`,
                ]
              : [];
          return {
            name: service.name,
            status: 'running' as const,
            ports,
            containerId: preservedExisting.container_id,
            ...(orchestrationEntry?.error ? { error: orchestrationEntry.error } : {}),
          };
        }

        if (deployment && jobFailures.has(service.name)) {
          return {
            name: service.name,
            status: 'error' as const,
            ports: deployment.ports.map(
              (mapping) => `${String(mapping.hostPort)}:${String(mapping.containerPort)}`,
            ),
            containerId: deployment.containerId,
            error: jobFailures.get(service.name)?.message,
          };
        }

        if (deployment && orchestrationStatus === 'deployed') {
          return {
            name: service.name,
            status: completedServiceNames.has(service.name)
              ? ('stopped' as const)
              : ('running' as const),
            ports: deployment.ports.map(
              (mapping) => `${String(mapping.hostPort)}:${String(mapping.containerPort)}`,
            ),
            containerId: deployment.containerId,
          };
        }

        // F1 (Day 9 Bug #5 follow-up): rollback policy / generic-error paths
        // mean the container is STILL RUNNING despite the orchestration as a
        // whole failing. Preserve `running` + container metadata so downstream
        // child-project rows reflect reality (and operators can see/clean it
        // up). Without this, the switch fell through to `stopped`, hiding the
        // partial deployment.
        if (
          deployment &&
          (orchestrationStatus === 'rollback_failed_due_to_policy' ||
            orchestrationStatus === 'rollback_failed')
        ) {
          return {
            name: service.name,
            status: 'running' as const,
            ports: deployment.ports.map(
              (mapping) => `${String(mapping.hostPort)}:${String(mapping.containerPort)}`,
            ),
            containerId: deployment.containerId,
            error: orchestrationEntry?.error,
          };
        }

        if (
          orchestrationStatus === 'failed' ||
          orchestrationStatus === 'rolled_back' ||
          orchestrationStatus === 'skipped' ||
          orchestrationStatus === 'rollback_skipped'
        ) {
          // skipped / rollback_skipped: never deployed → 'stopped'.
          // failed / rolled_back: actively cleaned up → 'error'.
          const isStopped =
            orchestrationStatus === 'skipped' || orchestrationStatus === 'rollback_skipped';
          return {
            name: service.name,
            status: isStopped ? ('stopped' as const) : ('error' as const),
          };
        }

        return {
          name: service.name,
          status: 'stopped' as const,
        };
      });

      for (const status of reconciledStatuses) {
        if (reusedServiceNames.has(status.name)) continue;
        const childId = childrenByService.get(status.name);
        if (!childId) {
          continue;
        }

        await this.db.updateProject(childId, {
          status:
            status.status === 'running'
              ? 'running'
              : status.status === 'stopped'
                ? 'stopped'
                : 'error',
          containerId: status.containerId ?? null,
          assignedPort: status.ports?.[0] ? parseHostPort(status.ports[0]) : null,
        });

        if (status.status === 'running') {
          this.jobManager?.updatePhase(childId, 'done');
        } else if (status.status === 'stopped' && completedServiceNames.has(status.name)) {
          this.jobManager?.updatePhase(childId, 'done');
        } else if (status.status === 'stopped') {
          this.jobManager?.updatePhase(childId, 'failed', 'Service stopped after compose deploy');
        } else {
          this.jobManager?.updatePhase(childId, 'failed', 'Service failed during compose deploy');
        }
      }

      const failedOrchestration = orchestration.services
        .filter((service) => service.status === 'failed')
        .map((service) => `${service.name}: ${service.error ?? 'unknown error'}`);
      // F1 (Day 9 Bug #5 follow-up): partial-state services (rollback policy
      // blocked or rollback failed) are still running but represent a
      // half-deployed compose project. Surface them in the error message so
      // operators see "compose succeeded except svc-x is stuck running, see
      // reason".
      const partialStateServices = orchestration.services
        .filter(
          (service) =>
            service.status === 'rollback_failed_due_to_policy' ||
            service.status === 'rollback_failed',
        )
        .map((service) => `${service.name}: ${service.error ?? 'rollback skipped'}`);
      const hasError =
        !orchestration.success ||
        reconciledStatuses.some((status) => status.status === 'error') ||
        failedOrchestration.length > 0 ||
        partialStateServices.length > 0;
      if (hasError) {
        for (const [serviceName, preserved] of archivedStatefulRemovals) {
          await this.unarchiveApprovedStatefulRemoval(preserved);
          archivedStatefulRemovals.delete(serviceName);
        }
      }
      const failedJob = jobFailures.values().next().value;
      const failedPrerequisite = prerequisiteFailures.values().next().value;
      const errorMessage =
        failedOrchestration.length > 0 || partialStateServices.length > 0
          ? `One or more services failed to start (${[...failedOrchestration, ...partialStateServices].join('; ')})`
          : hasError
            ? 'One or more services failed to start'
            : undefined;

      await this.db.updateProject(parentProjectId, {
        status: hasError ? 'error' : 'running',
      });

      await this.db.createDeployLog({
        id: nanoid(12),
        projectId: parentProjectId,
        status: hasError ? 'failed' : 'success',
        trigger,
        commitSha: config.commitSha,
        commitMessage,
        buildLog,
        durationMs: Date.now() - startTime,
      });

      for (const status of reconciledStatuses) {
        if (
          existingReplacementByService.has(status.name) &&
          !createdDeploymentServiceNames.has(status.name)
        ) {
          continue;
        }
        const childId = childrenByService.get(status.name);
        if (!childId) continue;
        const jobFailure = jobFailures.get(status.name);
        const rawExitCode = jobFailure?.details?.['exitCode'];
        const exitCode =
          typeof rawExitCode === 'number' || typeof rawExitCode === 'string'
            ? rawExitCode
            : 'unknown';
        const completedJob = status.status === 'stopped' && completedServiceNames.has(status.name);
        const childFailed =
          status.status === 'error' ||
          Boolean(jobFailure) ||
          (status.status === 'stopped' && !completedJob);
        await this.db.createDeployLogForService({
          id: nanoid(12),
          serviceId: projectIdToDeployableServiceId(childId),
          status: childFailed ? 'failed' : 'success',
          trigger,
          commitSha: config.commitSha,
          commitMessage,
          buildLog: `${buildLogsByService.get(status.name) ?? ''}${
            jobFailure
              ? `[compose job ${status.name}] exit_code=${String(exitCode)} ${jobFailure.message}\n`
              : completedJob
                ? `[compose job ${status.name}] exit_code=0 completed\n`
                : `[compose service ${status.name}] status=${status.status}\n`
          }`,
          runtimeLog: runtimeLogsByService.get(status.name),
          durationMs: Date.now() - startTime,
        });
      }

      const parentLogTail = hasError
        ? buildLog.split('\n').filter(Boolean).slice(-30).join('\n')
        : undefined;
      this.jobManager?.updatePhase(
        parentProjectId,
        hasError ? 'failed' : 'done',
        hasError ? (errorMessage ?? 'One or more services failed to start') : undefined,
        parentLogTail,
      );

      if (hasError) {
        await this.events.emit('compose:failed', {
          projectId: parentProjectId,
          error: errorMessage ?? 'One or more services failed to start',
        });
      } else {
        if (config.gitCredentialId) {
          const parentService = await this.db.getDeployableForProject(parentProjectId);
          if (parentService) {
            await this.db.updateService(parentService.id, {
              gitCredentialId: config.gitCredentialId,
            });
          }
        }
        await this.events.emit('compose:up', {
          projectId: parentProjectId,
          services: reconciledStatuses.map((status) => status.name),
        });
      }

      return {
        success: !hasError,
        parentProjectId,
        parentName,
        services: reconciledStatuses,
        buildDurationMs: Date.now() - startTime,
        error: hasError ? (errorMessage ?? 'One or more services failed to start') : undefined,
        ...(failedJob
          ? {
              errorCode: failedJob.code,
              details: failedJob.details,
            }
          : failedPrerequisite
            ? {
                errorCode: failedPrerequisite.code,
                details: failedPrerequisite.details,
              }
            : {}),
        ...(trafficService
          ? {
              trafficService,
              trafficServiceProjectId: childrenByService.get(trafficService),
              trafficServicePort:
                deploymentByService.get(trafficService)?.ports[0]?.hostPort ??
                existingByName.get(`${parentName}/${trafficService}`)?.assigned_port ??
                undefined,
            }
          : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        serviceFingerprints: currentServiceFingerprints,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const buildLogWithError = appendComposeError(buildLog, error);

      for (const [serviceName, deployment] of deploymentByService.entries()) {
        if (!createdDeploymentServiceNames.has(serviceName)) continue;
        try {
          await this.docker.stopContainer(deployment.containerId);
        } catch (stopError) {
          if (!isDockerNotFoundError(stopError)) {
            log.debug(
              { err: stopError, serviceName },
              'Failed to stop compose service during rollback',
            );
          }
        }
        await this.cleanupComposeContainer(
          deployment.containerId,
          this.composeNetworkNames(projectNetwork, envType),
          'compose-orchestration-error',
        );
        const containerName = containerNameByService.get(serviceName);
        if (containerName && containerName !== deployment.containerId) {
          await this.cleanupComposeContainer(
            containerName,
            this.composeNetworkNames(projectNetwork, envType),
            'compose-orchestration-error-name',
          );
        }
      }

      for (const [serviceName, preserved] of statefulSwaps) {
        const childId = childrenByService.get(serviceName);
        if (!childId) continue;
        await this.restorePreservedStatefulContainer(preserved, childId);
        restoredStatefulServiceNames.add(serviceName);
        statefulSwaps.delete(serviceName);
      }
      for (const [serviceName, preserved] of archivedStatefulRemovals) {
        await this.unarchiveApprovedStatefulRemoval(preserved);
        archivedStatefulRemovals.delete(serviceName);
      }

      await this.transitionProjectStatus(parentProjectId, 'error', 'compose-orchestration-error');
      for (const service of filteredComposeProject.services) {
        if (reusedServiceNames.has(service.name)) {
          continue;
        }
        const childId = childrenByService.get(service.name);
        if (!childId) continue;
        if (restoredStatefulServiceNames.has(service.name)) {
          const previous = existingByName.get(`${parentName}/${service.name}`);
          await this.db.updateProject(childId, {
            status: 'running',
            containerId: previous?.container_id ?? null,
            assignedPort: previous?.assigned_port ?? null,
          });
          this.jobManager?.updatePhase(childId, 'done');
          continue;
        }
        const preservedExisting = existingByName.get(`${parentName}/${service.name}`);
        if (preservedExisting?.container_id && !createdDeploymentServiceNames.has(service.name)) {
          await this.db.updateProject(childId, {
            status: 'running',
            containerId: preservedExisting.container_id,
            assignedPort: preservedExisting.assigned_port ?? null,
          });
          this.jobManager?.updatePhase(childId, 'done');
          continue;
        }
        await this.db.updateProject(childId, {
          status: 'error',
          containerId: null,
          assignedPort: null,
        });
      }

      await this.db.createDeployLog({
        id: nanoid(12),
        projectId: parentProjectId,
        status: 'failed',
        trigger,
        commitSha: config.commitSha,
        commitMessage,
        buildLog: buildLogWithError,
        durationMs: Date.now() - startTime,
      });

      const buildLogTail = buildLogWithError.split('\n').filter(Boolean).slice(-30).join('\n');
      this.jobManager?.updatePhase(parentProjectId, 'failed', errorMsg, buildLogTail);

      await this.events.emit('compose:failed', {
        projectId: parentProjectId,
        error: errorMsg,
      });

      return {
        success: false,
        parentProjectId,
        parentName,
        services: [],
        buildDurationMs: Date.now() - startTime,
        error: errorMsg,
        ...(trafficService ? { trafficService } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        serviceFingerprints: currentServiceFingerprints,
      };
    }
  }

  async stopCompose(projectId: string): Promise<void> {
    const parent = await this.resolveParentProject(projectId);
    // PR 2: fetch compose children via services.parent_service_id.
    const children = await this.db.getComposeChildProjects(parent.id);
    const projectNetwork = containerName(sanitizeComposeProjectName(parent.name));
    const networkNames = this.composeNetworkNames(projectNetwork, 'production');

    for (const child of children) {
      const serviceName = child.name.startsWith(`${parent.name}/`)
        ? child.name.slice(parent.name.length + 1)
        : child.name;
      const expectedContainerName = composeContainerName(parent.name, serviceName);

      if (child.container_id) {
        try {
          await this.docker.stopContainer(child.container_id);
        } catch (error) {
          log.debug(
            { err: error, childProjectId: child.id, containerId: child.container_id },
            'Failed to stop compose child container',
          );
        }

        await this.cleanupComposeContainer(child.container_id, networkNames, 'compose-stop');
      }

      await this.cleanupComposeContainer(expectedContainerName, networkNames, 'compose-stop-name');

      await this.transitionProjectStatus(child.id, 'stopped', 'compose-service-stop');
    }

    await this.docker.removeProjectNetwork(parent.name);
    await this.transitionProjectStatus(parent.id, 'stopped', 'compose-parent-stop');

    await this.events.emit('compose:down', { projectId: parent.id });
  }

  async getServiceLogs(projectId: string, service?: string, lines = 100): Promise<string> {
    const parent = await this.resolveParentProject(projectId);
    // PR 2: fetch compose children via services.parent_service_id.
    const children = await this.db.getComposeChildProjects(parent.id);

    if (service) {
      const child = children.find((c) => c.name === `${parent.name}/${service}`);
      if (!child) {
        throw new Error(`Compose service not found: ${service}`);
      }
      if (!child.container_id) {
        throw new Error(`Compose service ${service} has no running container`);
      }
      return this.docker.getLogs(child.container_id, lines);
    }

    const chunks: string[] = [];
    for (const child of children) {
      if (!child.container_id) {
        continue;
      }

      const serviceName = child.name.startsWith(`${parent.name}/`)
        ? child.name.slice(parent.name.length + 1)
        : child.name;
      const logs = await this.docker.getLogs(child.container_id, lines);
      chunks.push(`=== ${serviceName} ===\n${logs}`);
    }

    return chunks.join('\n');
  }

  async getServiceStatuses(projectId: string): Promise<ComposeServiceStatus[]> {
    const parent = await this.resolveParentProject(projectId);
    // PR 2: fetch compose children via services.parent_service_id.
    const children = await this.db.getComposeChildProjects(parent.id);
    return children.map((child) => {
      const serviceName = child.name.startsWith(`${parent.name}/`)
        ? child.name.slice(parent.name.length + 1)
        : child.name;
      const status: ComposeServiceStatus['status'] =
        child.status === 'running' ? 'running' : child.status === 'stopped' ? 'stopped' : 'error';
      const ports = child.assigned_port !== null ? [String(child.assigned_port)] : undefined;

      return {
        name: serviceName,
        status,
        ports,
        containerId: child.container_id ?? undefined,
      };
    });
  }

  private async resolveParentProject(projectId: string): Promise<ProjectRow> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    // PR 2: read parent relationship from services.parent_service_id instead of
    // projects.parent_project_id. Convention: deployable service id = <projectId>__svc.
    const svc = await this.db.getService(`${projectId}__svc`);
    if (!svc?.parent_service_id) {
      // No parent service — this is already a top-level group.
      return project;
    }
    // Derive parent project id by stripping the __svc suffix.
    const parentProjectId = svc.parent_service_id.replace(/__svc$/, '');
    const parent = await this.db.getProject(parentProjectId);
    if (!parent) {
      throw new Error(`Parent project not found: ${parentProjectId}`);
    }
    return parent;
  }

  private resolveServiceContainerPorts(
    service: ComposeService,
    envVars: Record<string, string>,
  ): number[] {
    const containerPorts: number[] = [];
    for (const mapping of service.ports ?? []) {
      const parsed = parseComposePortMapping(interpolateComposeValue(mapping, envVars));
      if (parsed) {
        // Published host ports belong to the source machine. OpenLander always
        // allocates a collision-free host port and preserves only the target.
        containerPorts.push(parsed.containerPort);
      }
    }
    for (const exposedPort of service.expose ?? []) {
      const parsed = parseComposePortMapping(interpolateComposeValue(exposedPort, envVars));
      if (parsed) {
        containerPorts.push(parsed.containerPort);
      }
    }
    if (containerPorts.length === 0) {
      const healthcheckPort = inferComposeHealthcheckPort(service);
      if (healthcheckPort !== undefined) {
        containerPorts.push(healthcheckPort);
      }
    }
    return [...new Set(containerPorts)];
  }

  private async allocateComposePortMappings(
    service: ComposeService,
    envVars: Record<string, string>,
    envType: OpenLanderEnv,
  ): Promise<Array<{ hostPort: number; containerPort: number }>> {
    const containerPorts = this.resolveServiceContainerPorts(service, envVars);
    if (containerPorts.length === 0) {
      const hostPort = await allocatePort(this.db, this.docker, {}, envType);
      return [{ hostPort, containerPort: hostPort }];
    }

    const mappings: Array<{ hostPort: number; containerPort: number }> = [];
    try {
      for (const containerPort of containerPorts) {
        const hostPort = await allocatePort(this.db, this.docker, {}, envType);
        mappings.push({ hostPort, containerPort });
      }
      return mappings;
    } catch (error) {
      for (const mapping of mappings) releasePortReservation(mapping.hostPort);
      throw error;
    }
  }

  private filteredComposeProjectForConfig(
    config: Pick<ComposeDeployConfig, 'composePath' | 'composePaths' | 'profiles' | 'services'>,
    composeProject = this.parseComposeFiles(config.composePaths ?? [config.composePath]),
  ): ComposeProject {
    validateComposeProfiles(composeProject.services, config.profiles);
    const filtered: ComposeProject = {
      ...composeProject,
      services: filterServicesByProfiles(composeProject.services, config.profiles),
    };

    filtered.services = selectComposeServices(filtered.services, config.services);

    return filtered;
  }

  private validateComposeInterpolation(
    composeProject: ComposeProject,
    envVars: Record<string, string>,
  ): void {
    for (const service of composeProject.services) {
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- Compose YAML field, not a services table column
      if (service.image) interpolateComposeValue(service.image, envVars);
      for (const value of service.ports ?? []) interpolateComposeValue(value, envVars);
      for (const value of service.expose ?? []) interpolateComposeValue(value, envVars);
      for (const value of service.volumes ?? []) interpolateComposeValue(value, envVars);
      if (Array.isArray(service.environment)) {
        for (const value of service.environment) interpolateComposeValue(value, envVars);
      } else if (service.environment) {
        for (const value of Object.values(service.environment)) {
          interpolateComposeValue(value, envVars);
        }
      }
    }
  }

  resolveComposeServiceImageTag(
    service: ComposeService,
    projectName: string,
    envVars: Record<string, string>,
  ): string {
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    if (service.image && service.image.length > 0) {
      return interpolateComposeValue(service.image, envVars); // eslint-disable-line openlander-internal/no-dropped-columns
    }

    if (service.build) {
      return `${composeContainerName(projectName, service.name)}:latest`;
    }

    throw new Error(`Service ${service.name} must define either build or image`);
  }

  private resolveBuildContext(
    projectPath: string,
    service: ComposeService,
  ): { contextPath: string; dockerfile?: string } {
    if (!service.build) {
      throw new Error(`Service ${service.name} does not have build configuration`);
    }

    if (typeof service.build === 'string') {
      return {
        contextPath: join(projectPath, service.build),
      };
    }

    return {
      contextPath: join(projectPath, service.build.context),
      dockerfile: service.build.dockerfile,
    };
  }

  resolveComposeServiceRuntimeEnv(
    service: ComposeService,
    baseEnvVars: Record<string, string>,
    projectPath: string,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};
    const root = resolve(projectPath);
    for (const envFile of service.envFile ?? []) {
      const envFilePath = resolve(root, envFile.path);
      if (envFilePath !== root && !envFilePath.startsWith(`${root}${sep}`)) {
        throw new ServiceConfigError(`Compose env_file escapes the repository: ${envFile.path}`, {
          service: service.name,
        });
      }
      if (!existsSync(envFilePath)) continue;
      for (const [key, value] of parseEnvFile(envFilePath)) {
        resolved[key] = interpolateComposeValue(value, baseEnvVars);
      }
    }

    if (!service.environment) {
      return resolved;
    }

    if (Array.isArray(service.environment)) {
      for (const item of service.environment) {
        const line = item.trim();
        if (!line) continue;

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
          resolved[line] = baseEnvVars[line] ?? resolved[line] ?? process.env[line] ?? '';
          continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key) {
          continue;
        }
        resolved[key] = interpolateComposeValue(line.slice(separatorIndex + 1), baseEnvVars);
      }
      return resolved;
    }

    for (const [key, value] of Object.entries(service.environment)) {
      resolved[key] = interpolateComposeValue(value, baseEnvVars);
    }

    return resolved;
  }

  private async waitForComposeJob(
    containerId: string,
    timeoutMs: number,
  ): Promise<{ healthy: boolean; error?: string; exitCode: number | null }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const info = await this.docker.inspectContainer(containerId);
        if (!info.State.Running) {
          return info.State.ExitCode === 0
            ? { healthy: true, exitCode: 0 }
            : {
                healthy: false,
                error: `Compose job exited with code ${String(info.State.ExitCode)}`,
                exitCode: info.State.ExitCode,
              };
        }
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { healthy: false, error: 'Compose job container not found', exitCode: null };
        }
      }
      await sleep(500);
    }
    return {
      healthy: false,
      error: 'Compose job did not complete before timeout',
      exitCode: null,
    };
  }

  private async resolveComposeServiceMounts(
    projectName: string,
    service: ComposeService,
    projectPath: string,
    envVars: Record<string, string>,
    imageTag: string,
  ): Promise<{
    binds: string[];
    fileCopies: Array<{ sourcePath: string; targetPath: string; readOnly: boolean }>;
  }> {
    const binds: string[] = [];
    const fileCopies: Array<{ sourcePath: string; targetPath: string; readOnly: boolean }> = [];
    for (const [index, rawVolume] of (service.volumes ?? []).entries()) {
      const volume = interpolateComposeValue(rawVolume, envVars).trim();
      if (!volume) continue;
      const tokens = volume.split(':');
      if (tokens.length === 1) {
        const target = tokens[0];
        if (!target?.startsWith('/')) {
          throw new ServiceConfigError(`Invalid Compose volume target: ${volume}`, {
            service: service.name,
          });
        }
        const volumeName = composeContainerName(
          projectName,
          `volume-${service.name}-${String(index + 1)}`,
        );
        binds.push(`${volumeName}:${target}`);
        continue;
      }

      const source = tokens[0]?.trim();
      const target = tokens[1]?.trim();
      const mode = tokens.slice(2).join(':').trim();
      if (!source || !target?.startsWith('/')) {
        throw new ServiceConfigError(`Invalid Compose volume mapping: ${volume}`, {
          service: service.name,
        });
      }

      if (source.startsWith('.')) {
        const root = resolve(projectPath);
        const absoluteSource = resolve(root, source);
        if (absoluteSource !== root && !absoluteSource.startsWith(`${root}${sep}`)) {
          throw new ServiceConfigError(`Compose bind mount escapes the repository: ${source}`, {
            service: service.name,
          });
        }
        if (!existsSync(absoluteSource)) {
          throw new ServiceConfigError(`Imported Compose bind source does not exist: ${source}`, {
            service: service.name,
          });
        }
        const canonicalRoot = realpathSync(root);
        const canonicalSource = realpathSync(absoluteSource);
        if (
          canonicalSource !== canonicalRoot &&
          !canonicalSource.startsWith(`${canonicalRoot}${sep}`)
        ) {
          throw new ServiceConfigError(`Compose bind mount escapes the repository: ${source}`, {
            service: service.name,
          });
        }
        const sourceStat = statSync(canonicalSource);
        if (sourceStat.isFile()) {
          fileCopies.push({
            sourcePath: canonicalSource,
            targetPath: target,
            readOnly: mode.split(',').includes('ro'),
          });
          continue;
        }
        if (!sourceStat.isDirectory()) {
          throw new ServiceConfigError(
            `Imported Compose bind source must be a file or directory: ${source}`,
            { service: service.name },
          );
        }
        const volumeName = composeContainerName(
          projectName,
          `bind-${service.name}-${String(index + 1)}`,
        );
        await this.docker.seedVolumeFromDirectory({
          name: volumeName,
          sourcePath: canonicalSource,
          imageTag,
          labels: {
            'openlander.compose.project': projectName,
            'openlander.compose.service': service.name,
            'openlander.compose.bind-source': source,
          },
        });
        binds.push(`${volumeName}:${target}${mode ? `:${mode}` : ''}`);
        continue;
      }

      if (isAbsolute(source)) {
        throw new ServiceConfigError(
          `Absolute host bind mounts are not allowed in imported Compose projects: ${source}`,
          { service: service.name },
        );
      }

      const volumeName = composeContainerName(projectName, `volume-${source}`);
      binds.push(`${volumeName}:${target}${mode ? `:${mode}` : ''}`);
    }
    return { binds, fileCopies };
  }

  private resolveDockerHealthcheck(healthcheck: ComposeService['healthcheck']):
    | {
        test: string | string[];
        interval?: number;
        timeout?: number;
        retries?: number;
        start_period?: number;
      }
    | undefined {
    if (!healthcheck) {
      return undefined;
    }

    return {
      test: healthcheck.test,
      interval: parseComposeDurationSeconds(healthcheck.interval),
      timeout: parseComposeDurationSeconds(healthcheck.timeout),
      retries: healthcheck.retries,
      start_period: parseComposeDurationSeconds(healthcheck.start_period),
    };
  }

  private resolveComposeHealthTimeoutMs(healthcheck: ComposeService['healthcheck']): number {
    if (!healthcheck) return 20_000;
    const startPeriod = parseComposeDurationSeconds(healthcheck.start_period) ?? 0;
    const interval = parseComposeDurationSeconds(healthcheck.interval) ?? 30;
    const timeout = parseComposeDurationSeconds(healthcheck.timeout) ?? 30;
    const retries = healthcheck.retries ?? 3;
    const declaredWindowSeconds = startPeriod + interval * retries + timeout;
    return Math.min(10 * 60_000, Math.max(20_000, declaredWindowSeconds * 1_000));
  }
}

function parseComposeByteValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const match = value
    .trim()
    .toLowerCase()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? 'b';
  const multiplier =
    unit === 'k' || unit === 'kb' || unit === 'kib'
      ? 1024
      : unit === 'm' || unit === 'mb' || unit === 'mib'
        ? 1024 ** 2
        : unit === 'g' || unit === 'gb' || unit === 'gib'
          ? 1024 ** 3
          : 1;
  const bytes = amount * multiplier;
  return Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : undefined;
}

function parseComposeDurationSeconds(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  const tokenRegex = /([0-9]*\.?[0-9]+)\s*(ns|us|ms|s|m|h)/g;
  let match: RegExpExecArray | null;
  let consumedLength = 0;
  let seconds = 0;

  while ((match = tokenRegex.exec(normalized)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) {
      return undefined;
    }
    consumedLength += match[0].length;

    if (unit === 'h') {
      seconds += amount * 3600;
    } else if (unit === 'm') {
      seconds += amount * 60;
    } else if (unit === 's') {
      seconds += amount;
    } else if (unit === 'ms') {
      seconds += amount / 1000;
    } else if (unit === 'us') {
      seconds += amount / 1_000_000;
    } else if (unit === 'ns') {
      seconds += amount / 1_000_000_000;
    }
  }

  if (consumedLength !== normalized.length) {
    return undefined;
  }

  return Number.isFinite(seconds) ? seconds : undefined;
}

function parseHostPort(portMapping: string): number | null {
  const match = portMapping.match(/(\d+):(\d+)/);
  if (!match) {
    return null;
  }
  const hostPort = Number(match[1]);
  return Number.isFinite(hostPort) ? hostPort : null;
}

function formatComposePortValue(port: unknown): string {
  if (typeof port === 'string' || typeof port === 'number') {
    return String(port).trim();
  }

  if (!port || typeof port !== 'object' || Array.isArray(port)) {
    return '';
  }

  const objectPort = port as Record<string, unknown>;
  const published = scalarComposePortToken(objectPort['published']);
  const target = scalarComposePortToken(objectPort['target']);
  const protocol = objectPort['protocol'];
  const parts: string[] = [];

  if (published !== null) {
    parts.push(published);
  }
  if (target !== null) {
    parts.push(target);
  }

  const formatted = parts.join(':');
  if (formatted.length > 0 && typeof protocol === 'string' && protocol.length > 0) {
    return `${formatted}/${protocol}`;
  }
  if (formatted.length > 0) {
    return formatted;
  }

  return JSON.stringify(objectPort);
}

function scalarComposePortToken(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeComposeStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    return normalized.length > 0 ? [normalized] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) =>
      typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '',
    )
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function interpolateComposeValue(value: string, envVars: Record<string, string>): string {
  const escapedDollar = '\u0000OPENLANDER_COMPOSE_DOLLAR\u0000';
  const escaped = value.replaceAll('$$', escapedDollar);
  const interpolated = escaped.replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?:(:-|-|:\?|\?)([^}]*))?\}/g,
    (_match, key: string, operator: string | undefined, operand: string | undefined) => {
      const explicitlyProvided = Object.prototype.hasOwnProperty.call(envVars, key);
      const raw = explicitlyProvided ? envVars[key] : process.env[key];
      const isSet = raw !== undefined;
      const isNonEmpty = isSet && raw.length > 0;

      if (!operator) return raw ?? '';
      if (operator === ':-') return isNonEmpty ? raw : (operand ?? '');
      if (operator === '-') return isSet ? raw : (operand ?? '');
      if (operator === ':?') {
        if (isNonEmpty) return raw;
      } else if (operator === '?') {
        if (isSet) return raw;
      }

      throw new ServiceConfigError(
        operand?.trim() || `Compose environment variable ${key} is required`,
        { key },
      );
    },
  );
  return interpolated.replaceAll(escapedDollar, '$');
}

function parseComposePortMapping(
  portMapping: string,
): { hostPort: number | null; containerPort: number } | null {
  const normalized = portMapping.trim();
  if (!normalized) {
    return null;
  }

  const withoutProtocol = normalized.split('/')[0] ?? normalized;
  const tokens = withoutProtocol
    .split(':')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  const numericTokens = tokens.filter((token) => /^\d+$/.test(token));
  if (numericTokens.length === 0) {
    return null;
  }

  if (numericTokens.length === 1) {
    const containerPort = Number(numericTokens[0]);
    if (!Number.isFinite(containerPort)) {
      return null;
    }
    return { hostPort: null, containerPort };
  }

  const containerPort = Number(numericTokens[numericTokens.length - 1]);
  const hostPort = Number(numericTokens[numericTokens.length - 2]);
  if (!Number.isFinite(containerPort) || !Number.isFinite(hostPort)) {
    return null;
  }

  return { hostPort, containerPort };
}
