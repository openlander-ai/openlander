import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
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
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { nanoid } from 'nanoid';
import { allocatePort } from './port.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import { connectToTraefikNetwork } from './traefik.js';
import type { Docker } from './docker.js';
import type { Database, ProjectRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { EnvManager } from './env.js';
import type { JobManager } from './job-manager.js';

const log = createModuleLogger('compose');

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

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
  composePath: string;
  profiles?: string[];
  services?: string[];
  name?: string;
  envVars?: Record<string, string>;
  trigger?: 'chat' | 'webhook' | 'api';
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

export interface PortConflict {
  service: string;
  requestedPort: number;
  conflictsWith: string;
}

export interface EnvFileReferenceError {
  service: string;
  envFilePath: string;
  requiredVars: string[];
  templatePath: string | null;
}

interface ParsedComposePsRow {
  service: string;
  status: 'running' | 'stopped' | 'error';
  ports: string[];
  containerId?: string;
}

// Minimum supported Docker Compose version.
// Features used: ps --format json (V2.1.0+)
const MIN_COMPOSE_VERSION = '2.1.0';

export class ComposePipeline {
  versionChecked = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly jobManager?: JobManager,
    private readonly env?: EnvManager,
  ) {
    void this.docker;
  }

  private async checkComposeVersion(): Promise<void> {
    if (this.versionChecked) return;
    this.versionChecked = true;
    try {
      const result = await this.execCompose('/dev/null', ['version', '--short']);
      const version = result.stdout.trim().replace(/^v/i, '');
      const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10));
      const [reqMajor, reqMinor, reqPatch] = MIN_COMPOSE_VERSION.split('.').map((n) =>
        parseInt(n, 10),
      );
      const current = (major ?? 0) * 10000 + (minor ?? 0) * 100 + (patch ?? 0);
      const required = (reqMajor ?? 0) * 10000 + (reqMinor ?? 0) * 100 + (reqPatch ?? 0);
      if (current < required) {
        log.warn(
          { detected: version, minimum: MIN_COMPOSE_VERSION },
          `Docker Compose ${version} is below minimum ${MIN_COMPOSE_VERSION}. Compose deploys may fail.`,
        );
      }
    } catch {
      log.warn('Could not detect Docker Compose version. Compose deploys may fail.');
    }
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
    const startTime = Date.now();
    const trigger = config.trigger ?? 'chat';
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const parentProjectId = config._parentId ?? nanoid(12);
    let buildLog = '';

    const composeProject = this.parseComposeFile(config.composePath);
    const filteredComposeProject: ComposeProject = {
      ...composeProject,
      services: filterServicesByProfiles(composeProject.services, config.profiles),
    };

    if (config.services && config.services.length > 0) {
      const requestedServices = new Set(config.services);
      filteredComposeProject.services = filteredComposeProject.services.filter((s) =>
        requestedServices.has(s.name),
      );
    }

    const envVars = { ...(config.envVars ?? {}) };

    // Create empty placeholders for ALL services' env_file entries first
    // This prevents docker compose validation failures for non-deploy_only services
    this.touchMissingEnvFiles(composeProject);

    // Check env_file references for filtered (deploy_only) services
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

    if (this.env) {
      const secretFiles = this.env.getSecretFilesForDeploy(parentProjectId);
      if (secretFiles.length > 0) {
        const secretMounts = this.writeComposeSecretFiles(parentName, secretFiles);
        this.writeSecretOverride(config.composePath, filteredComposeProject.services, secretMounts);
      }
    }

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
    // Look up existing children to reuse on redeploy
    const existingChildren = this.db.getChildProjects(parentProjectId);
    const existingByName = new Map(existingChildren.map((c) => [c.name, c]));

    for (const service of filteredComposeProject.services) {
      const childName = `${parentName}/${service.name}`;
      const existing = existingByName.get(childName);

      let childId: string;
      if (existing) {
        // Reuse existing child project on redeploy
        childId = existing.id;
      } else {
        // Create new child project on first deploy
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
      this.db.updateProject(childId, { status: 'building' });
      this.jobManager?.trackJob(childId, childName);
    }

    await this.events.emit('compose:start', {
      projectId: parentProjectId,
      composePath: config.composePath,
      serviceCount: filteredComposeProject.services.length,
    });

    try {
      this.jobManager?.updatePhase(parentProjectId, 'building');

      const conflicts = this.detectPortConflicts(filteredComposeProject);
      if (conflicts.length > 0) {
        const override = await this.generateOverride(filteredComposeProject, conflicts);
        this.writeOverride(config.composePath, override);
        log.info({ conflicts: conflicts.length }, 'Generated port conflict override');
      }

      const conflictedPortsByService = new Map<string, Set<number>>();
      for (const conflict of conflicts) {
        const ports = conflictedPortsByService.get(conflict.service) ?? new Set<number>();
        ports.add(conflict.requestedPort);
        conflictedPortsByService.set(conflict.service, ports);
      }

      const services: ServiceNode[] = filteredComposeProject.services.map((service) => {
        const requestedPort = (service.ports ?? [])
          .map((mapping) => parseComposePortMapping(mapping))
          .find((parsed) => parsed?.hostPort !== null && parsed?.hostPort !== undefined)?.hostPort;
        const hasConflictedRequestedPort =
          requestedPort !== undefined &&
          requestedPort !== null &&
          (conflictedPortsByService.get(service.name)?.has(requestedPort) ?? false);

        return {
          name: service.name,
          composePath: config.composePath,
          dependsOn: service.dependsOn ?? [],
          port:
            requestedPort !== undefined && requestedPort !== null && !hasConflictedRequestedPort
              ? requestedPort
              : undefined,
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

      await this.checkComposeVersion();

      const serviceStatusByName = new Map<string, ComposeServiceStatus>();
      const orchestration = await orchestrator.executeOrdered(topology, {
        deployService: async (service) => {
          this.jobManager?.updatePhase(parentProjectId, 'starting');

          const upArgs = ['up', '-d', '--build', '--no-deps', service.name];

          const upResult = await this.execCompose(config.composePath, upArgs);
          buildLog += `[compose up ${service.name}]\n${upResult.stdout}${upResult.stderr}`;

          if (upResult.exitCode !== 0) {
            const childId = childrenByService.get(service.name);
            if (childId) {
              this.db.updateProject(childId, { status: 'error' });
              const composeLogTail = (upResult.stdout + upResult.stderr)
                .split('\n')
                .filter(Boolean)
                .slice(-30)
                .join('\n');
              this.jobManager?.updatePhase(
                childId,
                'failed',
                upResult.stderr || upResult.stdout || `docker compose failed for ${service.name}`,
                composeLogTail,
              );
            }
            return {
              success: false,
              projectId: childId,
              error: `docker compose up failed for ${service.name}: ${upResult.stderr || upResult.stdout}`,
            };
          }

          return {
            success: true,
            projectId: childrenByService.get(service.name),
          };
        },
        waitForHealthy: async (service) => {
          const statuses = await this.getServiceStatuses(parentProjectId);
          for (const status of statuses) {
            serviceStatusByName.set(status.name, status);
          }
          const status = statuses.find((entry) => entry.name === service.name);
          if (!status) {
            return {
              healthy: false,
              error: `Service ${service.name} status not found after compose up`,
            };
          }

          if (status.status === 'running') {
            return { healthy: true };
          }

          if (status.status === 'error') {
            return {
              healthy: false,
              error: `Service ${service.name} reported error state`,
            };
          }

          if (servicesWithDependents.has(service.name)) {
            return {
              healthy: false,
              error: `Service ${service.name} is ${status.status} and required by dependent services`,
            };
          }

          return { healthy: true };
        },
        rollbackService: async (service) => {
          const stopResult = await this.execCompose(config.composePath, ['stop', service.name]);
          buildLog += `[compose rollback stop ${service.name}]\n${stopResult.stdout}${stopResult.stderr}`;

          const rmResult = await this.execCompose(config.composePath, ['rm', '-f', service.name]);
          buildLog += `[compose rollback rm ${service.name}]\n${rmResult.stdout}${rmResult.stderr}`;

          const childId = childrenByService.get(service.name);
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
        },
      });

      const statuses = await this.getServiceStatuses(parentProjectId);
      for (const status of statuses) {
        serviceStatusByName.set(status.name, status);
      }

      const orchestrationByService = new Map(
        orchestration.services.map((service) => [service.name, service]),
      );
      const reconciledStatuses = filteredComposeProject.services.map((service) => {
        const status = serviceStatusByName.get(service.name);
        const orchestrationStatus = orchestrationByService.get(service.name)?.status;

        if (!status) {
          return {
            name: service.name,
            status:
              orchestrationStatus === 'failed' ||
              orchestrationStatus === 'rolled_back' ||
              orchestrationStatus === 'skipped'
                ? ('error' as const)
                : ('stopped' as const),
          };
        }

        if (orchestrationStatus === 'rolled_back' || orchestrationStatus === 'failed') {
          return {
            ...status,
            status: 'error' as const,
          };
        }

        if (orchestrationStatus === 'skipped') {
          return {
            ...status,
            status: 'stopped' as const,
          };
        }

        return status;
      });

      for (const status of reconciledStatuses) {
        const childId = childrenByService.get(status.name);
        if (!childId) continue;
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
        buildLog,
        durationMs: Date.now() - startTime,
      });

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

      const parentLogTail = hasError
        ? buildLog.split('\n').filter(Boolean).slice(-30).join('\n')
        : undefined;
      this.jobManager?.updatePhase(
        parentProjectId,
        hasError ? 'failed' : 'done',
        hasError ? (errorMessage ?? 'One or more services failed to start') : undefined,
        parentLogTail,
      );

      for (const status of reconciledStatuses) {
        if (status.status !== 'running' || !status.containerId) {
          continue;
        }

        try {
          await connectToTraefikNetwork(this.docker, status.containerId, 'web');
        } catch (err) {
          log.debug(
            { err, service: status.name, containerId: status.containerId },
            'Failed to connect compose service container to web network',
          );
        }
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

      this.db.updateProject(parentProjectId, { status: 'error' });
      for (const childId of childrenByService.values()) {
        this.db.updateProject(childId, { status: 'error' });
      }

      this.db.createDeployLog({
        id: nanoid(12),
        projectId: parentProjectId,
        status: 'failed',
        trigger,
        buildLog: `${buildLog}[error] ${errorMsg}\n`,
        durationMs: Date.now() - startTime,
      });

      await this.events.emit('compose:failed', {
        projectId: parentProjectId,
        error: errorMsg,
      });

      this.jobManager?.updatePhase(parentProjectId, 'failed', errorMsg);

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
    const composePath = this.resolveComposePath(parent);

    const result = await this.execCompose(composePath, ['down']);
    if (result.exitCode !== 0) {
      throw new Error(`docker compose down failed: ${result.stderr || result.stdout}`);
    }

    for (const child of this.db.getChildProjects(parent.id)) {
      this.db.updateProject(child.id, { status: 'stopped' });
    }
    this.db.updateProject(parent.id, { status: 'stopped' });

    await this.events.emit('compose:down', { projectId: parent.id });
  }

  async getServiceLogs(projectId: string, service?: string, lines = 100): Promise<string> {
    const parent = this.resolveParentProject(projectId);
    const composePath = this.resolveComposePath(parent);

    const args = ['logs', `--tail=${String(lines)}`];
    if (service) {
      args.push(service);
    }

    const result = await this.execCompose(composePath, args);
    if (result.exitCode !== 0) {
      throw new Error(`docker compose logs failed: ${result.stderr || result.stdout}`);
    }

    return `${result.stdout}${result.stderr}`;
  }

  async getServiceStatuses(projectId: string): Promise<ComposeServiceStatus[]> {
    const parent = this.resolveParentProject(projectId);
    const composePath = this.resolveComposePath(parent);

    const result = await this.execCompose(composePath, ['ps', '--format', 'json']);
    if (result.exitCode !== 0) {
      throw new Error(`docker compose ps failed: ${result.stderr || result.stdout}`);
    }

    const rows = parseComposePsOutput(result.stdout);
    return rows.map((row) => ({
      name: row.service,
      status: row.status,
      ports: row.ports.length > 0 ? row.ports : undefined,
      containerId: row.containerId,
    }));
  }

  detectPortConflicts(composeProject: ComposeProject): PortConflict[] {
    const runningProjects = this.db.listProjects('running');
    const projectByPort = new Map<number, ProjectRow>();
    for (const project of runningProjects) {
      if (project.assigned_port !== null) {
        projectByPort.set(project.assigned_port, project);
      }
    }

    const conflicts: PortConflict[] = [];

    for (const service of composeProject.services) {
      for (const mapping of service.ports ?? []) {
        const parsed = parseComposePortMapping(mapping);
        if (!parsed || parsed.hostPort === null) {
          continue;
        }

        const conflictingProject = projectByPort.get(parsed.hostPort);
        if (!conflictingProject) {
          continue;
        }

        conflicts.push({
          service: service.name,
          requestedPort: parsed.hostPort,
          conflictsWith: conflictingProject.name || 'system',
        });
      }
    }

    return conflicts;
  }

  async generateOverride(
    composeProject: ComposeProject,
    conflicts: PortConflict[],
  ): Promise<string> {
    const requestedByService = new Map<string, Set<number>>();
    for (const conflict of conflicts) {
      const current = requestedByService.get(conflict.service) ?? new Set<number>();
      current.add(conflict.requestedPort);
      requestedByService.set(conflict.service, current);
    }

    const reservedPorts = new Set<number>();
    const allocateUniquePort = async (): Promise<number> => {
      let min = 10001;
      for (;;) {
        const candidate = await allocatePort(this.db, this.docker, { rangeStart: min });
        if (!reservedPorts.has(candidate)) {
          reservedPorts.add(candidate);
          return candidate;
        }
        min = candidate + 1;
      }
    };

    const overrideServices: Record<string, { ports: string[] }> = {};

    for (const service of composeProject.services) {
      const requestedPorts = requestedByService.get(service.name);
      if (!requestedPorts || requestedPorts.size === 0) {
        continue;
      }

      const remappedPorts: string[] = [];
      for (const mapping of service.ports ?? []) {
        const parsed = parseComposePortMapping(mapping);
        if (!parsed || parsed.hostPort === null || !requestedPorts.has(parsed.hostPort)) {
          continue;
        }

        const newHostPort = await allocateUniquePort();
        remappedPorts.push(`${String(newHostPort)}:${String(parsed.containerPort)}`);
      }

      if (remappedPorts.length > 0) {
        overrideServices[service.name] = { ports: remappedPorts };
      }
    }

    return stringifyYaml({ services: overrideServices });
  }

  writeOverride(composePath: string, overrideContent: string): string {
    const overridePath = join(dirname(composePath), 'docker-compose.override.yml');
    writeFileSync(overridePath, overrideContent, 'utf8');
    return overridePath;
  }

  private writeComposeSecretFiles(
    projectName: string,
    files: Array<{ filename: string; content: string; mountPath: string }>,
  ): Array<{ hostPath: string; containerPath: string }> {
    const secretDir = join(homedir(), '.openlander', 'container-secrets', projectName);
    mkdirSync(secretDir, { recursive: true });
    const mounts: Array<{ hostPath: string; containerPath: string }> = [];
    for (const file of files) {
      const hostPath = join(secretDir, file.filename);
      writeFileSync(hostPath, file.content, { mode: 0o600 });
      mounts.push({ hostPath, containerPath: file.mountPath });
    }
    return mounts;
  }

  private writeSecretOverride(
    composePath: string,
    services: ComposeService[],
    mounts: Array<{ hostPath: string; containerPath: string }>,
  ): void {
    if (mounts.length === 0) return;
    const overridePath = join(dirname(composePath), 'docker-compose.override.yml');

    let existingOverride: Record<string, unknown> = {};
    if (existsSync(overridePath)) {
      const parsed = parseYaml(readFileSync(overridePath, 'utf8')) as Record<
        string,
        unknown
      > | null;
      existingOverride = parsed ?? {};
    }

    const overrideServices = (existingOverride['services'] ?? {}) as Record<
      string,
      { volumes?: string[]; ports?: string[] }
    >;
    for (const service of services) {
      const existing = overrideServices[service.name] ?? {};
      const volumes = [...(existing.volumes ?? [])];
      for (const mount of mounts) {
        volumes.push(`${mount.hostPath}:${mount.containerPath}:ro`);
      }
      overrideServices[service.name] = { ...existing, volumes };
    }

    writeFileSync(
      overridePath,
      stringifyYaml({ ...existingOverride, services: overrideServices }),
      'utf8',
    );
  }

  private touchMissingEnvFiles(composeProject: ComposeProject): void {
    for (const service of composeProject.services) {
      if (!service.envFile) continue;
      for (const envFileRef of service.envFile) {
        const fullPath = join(composeProject.projectPath, envFileRef.path);
        if (!existsSync(fullPath)) {
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, '', 'utf8');
          log.debug(
            { path: envFileRef.path, service: service.name },
            'Created empty env_file placeholder for compose validation',
          );
        }
      }
    }
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

  private async execCompose(
    composePath: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['compose', '-f', composePath, ...args], {
        cwd: dirname(composePath),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on('close', (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
          exitCode: code ?? 1,
        });
      });

      proc.on('error', reject);
    });
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

  private resolveComposePath(project: ProjectRow): string {
    const composePath = project.dockerfile_path;
    if (!composePath || !existsSync(composePath)) {
      throw new Error(`Compose file not found for project ${project.id}`);
    }
    return composePath;
  }
}

function parseComposePsOutput(output: string): ParsedComposePsRow[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  const parsedRows = tryParseComposeRows(trimmed);
  return parsedRows.map((row) => toParsedComposePsRow(row)).filter((row) => row.service.length > 0);
}

function tryParseComposeRows(output: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (row): row is Record<string, unknown> => !!row && typeof row === 'object',
      );
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as Record<string, unknown>];
    }
  } catch (error) {
    log.debug({ err: error }, 'Failed to parse compose ps output as a single JSON payload');
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const line of output.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    try {
      const parsed = JSON.parse(trimmedLine) as unknown;
      if (parsed && typeof parsed === 'object') {
        rows.push(parsed as Record<string, unknown>);
      }
    } catch (error) {
      log.debug({ err: error, line: trimmedLine }, 'Ignoring non-JSON compose ps output line');
    }
  }

  return rows;
}

function toParsedComposePsRow(row: Record<string, unknown>): ParsedComposePsRow {
  const service =
    (typeof row['Service'] === 'string' && row['Service']) ||
    (typeof row['Name'] === 'string' && row['Name']) ||
    '';

  const stateRaw =
    (typeof row['State'] === 'string' && row['State']) ||
    (typeof row['Status'] === 'string' && row['Status']) ||
    '';
  const stateNormalized = stateRaw.toLowerCase();

  let status: ParsedComposePsRow['status'];
  if (stateNormalized.includes('running') || stateNormalized.includes('up')) {
    status = 'running';
  } else if (
    stateNormalized.includes('exited') ||
    stateNormalized.includes('stopped') ||
    stateNormalized.includes('dead') ||
    stateNormalized.includes('created')
  ) {
    status = 'stopped';
  } else {
    status = 'error';
  }

  const ports: string[] = [];
  const publishers = row['Publishers'];
  if (Array.isArray(publishers)) {
    for (const publisher of publishers) {
      if (!publisher || typeof publisher !== 'object') continue;
      const item = publisher as Record<string, unknown>;
      const publishedPort = item['PublishedPort'];
      const targetPort = item['TargetPort'];
      if (typeof publishedPort === 'number' && typeof targetPort === 'number') {
        ports.push(`${String(publishedPort)}:${String(targetPort)}`);
      }
    }
  }

  if (ports.length === 0 && typeof row['Ports'] === 'string') {
    const portsText = row['Ports']
      .split(',')
      .map((port) => port.trim())
      .filter((port) => port.length > 0);
    ports.push(...portsText);
  }

  const containerId =
    (typeof row['ID'] === 'string' && row['ID']) ||
    (typeof row['ContainerID'] === 'string' && row['ContainerID']) ||
    undefined;

  return {
    service,
    status,
    ports,
    containerId,
  };
}

function extractProjectName(repoUrl: string): string {
  const cleaned = repoUrl
    .replace(/\.git$/, '')
    .replace(/^(https?:\/\/|git@)/, '')
    .replace(/:/g, '/');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] ?? 'project';
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
