import { createModuleLogger } from '../lib/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  checkEnvRequirements,
  classifyVar,
  detectEnvFile,
  parseEnvFile,
  formatEnvValue,
} from './env-inject.js';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { nanoid } from 'nanoid';
import { allocatePort, clearPortScanCache, releasePortReservation } from './port.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import { buildTraefikLabels } from './traefik.js';
import { getCommitSubject } from './git.js';
import { getPolicy } from '../config/index.js';
import type { OpenLanderEnv } from '../config/index.js';
import { extractProjectName, composeContainerName } from './helpers.js';
import type { Docker } from './docker.js';
import type { Database, ProjectRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { ProjectStatus, StateTransitionOptions } from '../monitor/project-state-manager.js';
import type { EnvManager } from './env.js';
import type { JobManager } from './job-manager.js';
import { isDockerNotFoundError } from '../errors.js';

const log = createModuleLogger('compose');

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

interface ProjectStateTransitioner {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
}

export interface ComposeService {
  name: string;
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  ports?: string[];
  profiles?: string[];
  environment?: Record<string, string> | string[];
  envFile?: ComposeEnvFile[];
  dependsOn?: string[];
  volumes?: string[];
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
}

export interface ComposeEnvFile {
  path: string;
  required: boolean;
}

export interface ComposeProject {
  services: ComposeService[];
  composePath: string;
  projectPath: string;
}

export interface ComposeDeployConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha?: string;
  composePath: string;
  profiles?: string[];
  services?: string[];
  name?: string;
  envVars?: Record<string, string>;
  trigger?: 'chat' | 'webhook' | 'api';
  environmentType?: OpenLanderEnv;
  _parentId?: string;
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
    };
  });
}

export interface ComposeDeployResult {
  success: boolean;
  parentProjectId: string;
  parentName: string;
  services: ComposeServiceStatus[];
  buildDurationMs: number;
  error?: string;
}

export interface ComposeServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  ports?: string[];
  containerId?: string;
}

export interface EnvFileReferenceError {
  service: string;
  envFilePath: string;
  requiredVars: string[];
  templatePath: string | null;
}

function sanitizeComposeProjectName(name: string): string {
  return name
    .replace(/\//g, '-')
    .replace(/[^a-z0-9_-]/gi, '')
    .toLowerCase();
}

export class ComposePipeline {
  private stateManager?: ProjectStateTransitioner;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly jobManager?: JobManager,
    private readonly env?: EnvManager,
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

    this.db.updateProject(projectId, { status: targetStatus });
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
    const raw = readFileSync(composePath, 'utf8');
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    const servicesRaw = parsed?.['services'];

    if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
      return { services: [], composePath, projectPath: dirname(composePath) };
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
          envObj[key] = envValue == null ? '' : String(envValue as string | number);
        }
        environment = envObj;
      }

      let dependsOn: string[] | undefined;
      if (Array.isArray(dependsOnRaw)) {
        dependsOn = dependsOnRaw.map((dep) => String(dep));
      } else if (dependsOnRaw && typeof dependsOnRaw === 'object') {
        dependsOn = Object.keys(dependsOnRaw as Record<string, unknown>);
      }

      const portsRaw = serviceObj['ports'];
      const volumesRaw = serviceObj['volumes'];
      const imageRaw = serviceObj['image'];
      const envFileRaw = serviceObj['env_file'];
      const profilesRaw = serviceObj['profiles'];
      const commandRaw = serviceObj['command'];
      const entrypointRaw = serviceObj['entrypoint'];
      const restartRaw = serviceObj['restart'];
      const healthcheckRaw = serviceObj['healthcheck'];

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
        ports: Array.isArray(portsRaw) ? portsRaw.map((port) => String(port)) : undefined,
        profiles,
        environment,
        envFile,
        dependsOn,
        volumes: Array.isArray(volumesRaw) ? volumesRaw.map((volume) => String(volume)) : undefined,
        command,
        entrypoint,
        restart,
        healthcheck,
      });
    }

    return {
      services,
      composePath,
      projectPath: dirname(composePath),
    };
  }

  startComposeDeploy(config: ComposeDeployConfig): {
    parentProjectId: string;
    parentName: string;
    status: 'building';
  } {
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const parentProjectId = nanoid(12);

    this.db.createProject({
      id: parentProjectId,
      name: parentName,
      repoUrl: config.repoUrl,
      branch: config.branch,
      dockerfilePath: config.composePath,
    });
    this.db.updateProject(parentProjectId, {
      status: 'building',
      dockerfilePath: config.composePath,
    });
    this.jobManager?.trackJob(parentProjectId, parentName);

    void this.deployCompose({ ...config, name: parentName, _parentId: parentProjectId }).catch(
      (error: unknown) => {
        log.error({ err: error, parentProjectId }, 'Background compose deploy failed');
      },
    );

    return { parentProjectId, parentName, status: 'building' };
  }

  async deployCompose(config: ComposeDeployConfig): Promise<ComposeDeployResult> {
    return this.deployComposeViaDockerode(config);
  }

  async deployComposeViaDockerode(config: ComposeDeployConfig): Promise<ComposeDeployResult> {
    const startTime = Date.now();
    const trigger = config.trigger ?? 'api';
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const projectName = sanitizeComposeProjectName(parentName);
    const parentProjectId = config._parentId ?? nanoid(12);
    const envType: OpenLanderEnv = 'production';
    let buildLog = '';
    const commitMessage = await getCommitSubject(config.clonePath, config.commitSha);

    const composeProject = this.parseComposeFile(config.composePath);
    const filteredComposeProject: ComposeProject = {
      ...composeProject,
      services: filterServicesByProfiles(composeProject.services, config.profiles),
    };

    if (config.services && config.services.length > 0) {
      const requestedServices = new Set(config.services);
      filteredComposeProject.services = filteredComposeProject.services.filter((service) =>
        requestedServices.has(service.name),
      );
    }

    const envVars = { ...(config.envVars ?? {}) };

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

    const envCheckResult = checkEnvRequirements(filteredComposeProject.projectPath, envVars);
    if (envCheckResult.missing.length > 0) {
      throw new Error(
        'compose env validation failed: ' +
          (envCheckResult.templateFile ?? '.env file') +
          ' is missing required variables: ' +
          envCheckResult.missing.join(', '),
      );
    }

    this.createComposeEnvFileIfMissing(filteredComposeProject.projectPath, envVars);

    if (!config._parentId) {
      this.db.createProject({
        id: parentProjectId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
        dockerfilePath: config.composePath,
      });
      this.jobManager?.trackJob(parentProjectId, parentName);
    }

    this.db.updateProject(parentProjectId, {
      status: 'building',
      dockerfilePath: config.composePath,
    });

    const childrenByService = new Map<string, string>();
    const existingChildren = this.db.getChildProjects(parentProjectId);
    const existingByName = new Map(existingChildren.map((c) => [c.name, c]));

    for (const service of filteredComposeProject.services) {
      const childName = `${parentName}/${service.name}`;
      const existing = existingByName.get(childName);

      let childId: string;
      if (existing) {
        childId = existing.id;
      } else {
        childId = nanoid(12);
        this.db.createProject({
          id: childId,
          name: childName,
          repoUrl: config.repoUrl,
          branch: config.branch,
          parentProjectId,
        });
      }

      childrenByService.set(service.name, childId);
      await this.transitionProjectStatus(childId, 'building', 'compose-build-start');
      this.jobManager?.trackJob(childId, childName);
    }

    const deployOnlyActive = Boolean(config.services && config.services.length > 0);
    if (!deployOnlyActive) {
      const composeServiceNames = new Set(composeProject.services.map((service) => service.name));
      const orphanChildren = existingChildren
        .map((child) => {
          const prefix = `${parentName}/`;
          if (!child.name.startsWith(prefix)) {
            return null;
          }

          const serviceName = child.name.slice(prefix.length);
          if (serviceName.length === 0 || composeServiceNames.has(serviceName)) {
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
          this.db.deleteProject(child.id);
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
      { containerId: string; port: number; containerPort: number }
    >();
    const containerNameByService = new Map<string, string>();
    const sharedSecretFiles = this.env?.getSecretFilesForDeploy(parentProjectId) ?? [];

    try {
      this.jobManager?.updatePhase(parentProjectId, 'building');

      const projectNetwork = await this.docker.ensureProjectNetwork(projectName);
      const services: ServiceNode[] = filteredComposeProject.services.map((service) => {
        const parsedPort = this.resolveServicePortMapping(service);
        return {
          name: service.name,
          composePath: config.composePath,
          dependsOn: service.dependsOn ?? [],
          port: parsedPort?.hostPort ?? undefined,
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

      const servicesWithDependents = new Set<string>();
      for (const service of topology.services) {
        for (const dependency of service.dependsOn) {
          servicesWithDependents.add(dependency);
        }
      }

      for (const service of filteredComposeProject.services) {
        const staleContainerName = composeContainerName(parentName, service.name);
        try {
          await this.docker.safeRemoveContainer(staleContainerName);
        } catch {
          // container doesn't exist — expected
        }
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

          let allocatedHostPort: number | null = null;

          try {
            this.jobManager?.updatePhase(childId, 'building');

            const imageTag = this.resolveComposeServiceImageTag(composeService, projectName);
            if (composeService.build) {
              const { contextPath, dockerfile } = this.resolveBuildContext(
                filteredComposeProject.projectPath,
                composeService,
              );
              buildLog += `[compose build ${service.name}] ${contextPath}\n`;
              await this.docker.buildComposeService({
                contextPath,
                dockerfile,
                tag: imageTag,
                cacheFrom: [imageTag],
              });
            } else {
              buildLog += `[compose pull ${service.name}] ${imageTag}\n`;
              await this.docker.pullImage(imageTag);
            }

            this.jobManager?.updatePhase(childId, 'starting');
            await this.docker.safeRemoveContainer(containerName);

            const parsedPort = this.resolveServicePortMapping(composeService);
            let hostPort = await allocatePort(
              this.db,
              this.docker,
              {
                preferredPort: parsedPort?.hostPort ?? undefined,
              },
              envType,
            );
            allocatedHostPort = hostPort;
            const containerPort = parsedPort?.containerPort ?? hostPort;
            const routeName = sanitizeComposeProjectName(`${projectName}-${service.name}`);
            const traefikLabels = buildTraefikLabels(routeName, containerPort, undefined, envType);
            const resolvedEnvVars = this.resolveComposeServiceEnvVars(composeService, envVars);
            const healthcheck = this.resolveDockerHealthcheck(composeService.healthcheck);

            let containerId: string | null = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                containerId = await this.docker.runComposeService({
                  imageTag,
                  name: containerName,
                  port: hostPort,
                  containerPort,
                  envVars: resolvedEnvVars,
                  traefikLabels,
                  secretFiles: sharedSecretFiles,
                  command: composeService.command,
                  entrypoint: composeService.entrypoint,
                  restart: composeService.restart,
                  healthcheck,
                  networks: [projectNetwork, getPolicy(envType).networkName],
                });
                break;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const isPortConflict =
                  message.includes('port is already allocated') ||
                  message.includes('address already in use');
                if (attempt === 0 && isPortConflict) {
                  releasePortReservation(hostPort);
                  clearPortScanCache();
                  hostPort = await allocatePort(this.db, this.docker, {}, envType);
                  allocatedHostPort = hostPort;
                  continue;
                }
                throw error;
              }
            }

            if (!containerId) {
              throw new Error(`Failed to start compose service ${service.name}`);
            }

            releasePortReservation(hostPort);
            allocatedHostPort = null;

            deploymentByService.set(service.name, {
              containerId,
              port: hostPort,
              containerPort,
            });

            this.db.updateProject(childId, {
              status: 'running',
              containerId,
              assignedPort: hostPort,
              imageTag,
            });
            this.jobManager?.updatePhase(childId, 'done');
            buildLog += `[compose run ${service.name}] ${containerId.slice(0, 12)} ${String(hostPort)}:${String(containerPort)}\n`;

            return {
              success: true,
              projectId: childId,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (allocatedHostPort !== null) {
              releasePortReservation(allocatedHostPort);
            }

            this.db.updateProject(childId, {
              status: 'error',
            });
            this.jobManager?.updatePhase(childId, 'failed', errorMsg);
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

          const healthResult = await this.docker.waitForHealthy(deployment.containerId, 20000);
          if (healthResult.healthy) {
            return { healthy: true };
          }

          if (servicesWithDependents.has(service.name)) {
            return {
              healthy: false,
              error:
                healthResult.error ??
                `Service ${service.name} failed health check and has dependent services`,
            };
          }

          return { healthy: true };
        },
        rollbackService: async (service) => {
          const deployment = deploymentByService.get(service.name);
          const containerName = containerNameByService.get(service.name);
          const childId = childrenByService.get(service.name);

          if (deployment) {
            try {
              await this.docker.stopContainer(deployment.containerId);
            } catch (error) {
              if (!isDockerNotFoundError(error)) {
                throw error;
              }
            }
            await this.docker.safeRemoveContainer(deployment.containerId);
            releasePortReservation(deployment.port);
          } else if (containerName) {
            try {
              await this.docker.stopContainer(containerName);
            } catch (error) {
              if (!isDockerNotFoundError(error)) {
                throw error;
              }
            }
            await this.docker.safeRemoveContainer(containerName);
          }

          if (childId) {
            this.db.updateProject(childId, {
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
        const orchestrationStatus = orchestrationByService.get(service.name)?.status;

        if (deployment && orchestrationStatus === 'deployed') {
          return {
            name: service.name,
            status: 'running' as const,
            ports: [`${String(deployment.port)}:${String(deployment.containerPort)}`],
            containerId: deployment.containerId,
          };
        }

        if (
          orchestrationStatus === 'failed' ||
          orchestrationStatus === 'rolled_back' ||
          orchestrationStatus === 'skipped'
        ) {
          return {
            name: service.name,
            status: orchestrationStatus === 'skipped' ? ('stopped' as const) : ('error' as const),
          };
        }

        return {
          name: service.name,
          status: 'stopped' as const,
        };
      });

      for (const status of reconciledStatuses) {
        const childId = childrenByService.get(status.name);
        if (!childId) {
          continue;
        }

        this.db.updateProject(childId, {
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
        } else if (status.status === 'stopped') {
          this.jobManager?.updatePhase(childId, 'failed', 'Service stopped after compose deploy');
        } else {
          this.jobManager?.updatePhase(childId, 'failed', 'Service failed during compose deploy');
        }
      }

      const failedOrchestration = orchestration.services
        .filter((service) => service.status === 'failed')
        .map((service) => `${service.name}: ${service.error ?? 'unknown error'}`);
      const hasError =
        !orchestration.success ||
        reconciledStatuses.some((status) => status.status === 'error') ||
        failedOrchestration.length > 0;
      const errorMessage =
        failedOrchestration.length > 0
          ? `One or more services failed to start (${failedOrchestration.join('; ')})`
          : hasError
            ? 'One or more services failed to start'
            : undefined;

      this.db.updateProject(parentProjectId, {
        status: hasError ? 'error' : 'running',
      });

      this.db.createDeployLog({
        id: nanoid(12),
        projectId: parentProjectId,
        status: hasError ? 'failed' : 'success',
        trigger,
        commitSha: config.commitSha,
        commitMessage,
        buildLog,
        durationMs: Date.now() - startTime,
      });

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
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      for (const [serviceName, deployment] of deploymentByService.entries()) {
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
        try {
          await this.docker.safeRemoveContainer(deployment.containerId);
        } catch (removeError) {
          log.debug(
            { err: removeError, serviceName },
            'Failed to remove compose service container during rollback',
          );
        }
      }

      await this.transitionProjectStatus(parentProjectId, 'error', 'compose-orchestration-error');
      for (const childId of childrenByService.values()) {
        this.db.updateProject(childId, {
          status: 'error',
          containerId: null,
          assignedPort: null,
        });
      }

      this.db.createDeployLog({
        id: nanoid(12),
        projectId: parentProjectId,
        status: 'failed',
        trigger,
        commitSha: config.commitSha,
        commitMessage,
        buildLog: `${buildLog}[error] ${errorMsg}\n`,
        durationMs: Date.now() - startTime,
      });

      this.jobManager?.updatePhase(parentProjectId, 'failed', errorMsg);

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
      };
    }
  }

  async stopCompose(projectId: string): Promise<void> {
    const parent = this.resolveParentProject(projectId);
    const children = this.db.getChildProjects(parent.id);

    for (const child of children) {
      if (child.container_id) {
        try {
          await this.docker.stopContainer(child.container_id);
        } catch (error) {
          log.debug(
            { err: error, childProjectId: child.id, containerId: child.container_id },
            'Failed to stop compose child container',
          );
        }

        try {
          await this.docker.safeRemoveContainer(child.container_id);
        } catch (error) {
          log.debug(
            { err: error, childProjectId: child.id, containerId: child.container_id },
            'Failed to remove compose child container',
          );
        }
      }

      await this.transitionProjectStatus(child.id, 'stopped', 'compose-service-stop');
    }

    await this.docker.removeProjectNetwork(parent.name);
    await this.transitionProjectStatus(parent.id, 'stopped', 'compose-parent-stop');

    await this.events.emit('compose:down', { projectId: parent.id });
  }

  async getServiceLogs(projectId: string, service?: string, lines = 100): Promise<string> {
    const parent = this.resolveParentProject(projectId);
    const children = this.db.getChildProjects(parent.id);

    if (service) {
      const child = children.find((entry) => entry.name === `${parent.name}/${service}`);
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

  getServiceStatuses(projectId: string): ComposeServiceStatus[] {
    const parent = this.resolveParentProject(projectId);
    const children = this.db.getChildProjects(parent.id);
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

  private createComposeEnvFileIfMissing(
    projectPath: string,
    envVars: Record<string, string>,
  ): void {
    const envTemplatePath = detectEnvFile(projectPath);
    if (!envTemplatePath) {
      return;
    }

    const envFilePath = join(projectPath, '.env');
    if (existsSync(envFilePath)) {
      return;
    }

    const templateVars = parseEnvFile(envTemplatePath);
    const envLines: string[] = [];

    for (const [key, templateValue] of templateVars.entries()) {
      const providedValue = envVars[key];
      const classification = classifyVar(key, templateValue);

      if (classification === 'secret' && providedValue === undefined) {
        envLines.push('# TODO: Set ' + key);
        envLines.push(key + '=');
        continue;
      }

      const resolvedValue = providedValue === undefined ? templateValue : providedValue;
      envLines.push(key + '=' + formatEnvValue(resolvedValue));
    }

    writeFileSync(envFilePath, envLines.join('\n') + '\n', 'utf8');
    log.info(
      { envFilePath, templateFile: envTemplatePath },
      'Generated compose .env file from template',
    );
  }

  private resolveParentProject(projectId: string): ProjectRow {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!project.parent_project_id) {
      return project;
    }

    const parent = this.db.getProject(project.parent_project_id);
    if (!parent) {
      throw new Error(`Parent project not found: ${project.parent_project_id}`);
    }
    return parent;
  }

  private resolveServicePortMapping(
    service: ComposeService,
  ): { hostPort: number | null; containerPort: number } | null {
    for (const mapping of service.ports ?? []) {
      const parsed = parseComposePortMapping(mapping);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  private resolveComposeServiceImageTag(service: ComposeService, projectName: string): string {
    if (service.image && service.image.length > 0) {
      return service.image;
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

  private resolveComposeServiceEnvVars(
    service: ComposeService,
    baseEnvVars: Record<string, string>,
  ): Record<string, string> {
    const resolved = { ...baseEnvVars };

    if (!service.environment) {
      return resolved;
    }

    if (Array.isArray(service.environment)) {
      for (const item of service.environment) {
        const line = item.trim();
        if (!line) continue;

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
          resolved[line] = resolved[line] ?? process.env[line] ?? '';
          continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key) {
          continue;
        }
        resolved[key] = line.slice(separatorIndex + 1);
      }
      return resolved;
    }

    for (const [key, value] of Object.entries(service.environment)) {
      resolved[key] = value;
    }

    return resolved;
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
