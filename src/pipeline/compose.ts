import { spawn } from 'node:child_process';
import { createModuleLogger } from '../lib/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { checkEnvRequirements, classifyVar, detectEnvFile, parseEnvFile } from './env-inject.js';
import { join, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { nanoid } from 'nanoid';
import { allocatePort } from './port.js';
import type { Docker } from './docker.js';
import type { Database, ProjectRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
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
  environment?: Record<string, string> | string[];
  envFile?: string[];
  dependsOn?: string[];
  volumes?: string[];
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
  name?: string;
  envVars?: Record<string, string>;
  trigger?: 'chat' | 'webhook' | 'api';
  _parentId?: string;
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

export class ComposePipeline {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly jobManager?: JobManager,
  ) {
    void this.docker;
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

      for (const envFilePath of service.envFile) {
        const fullPath = join(projectPath, envFilePath);

        // Already exists — nothing to do
        if (existsSync(fullPath)) {
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
                envLines.push(`${key}=${this.formatComposeEnvValue(value)}`);
              }
            }
          }

          // Append any providedVars not already covered by template
          for (const [key, value] of Object.entries(providedVars)) {
            if (usedKeys.has(key)) continue;
            envLines.push(`${key}=${this.formatComposeEnvValue(value)}`);
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

      // Parse env_file - can be a string or array
      let envFile: string[] | undefined;
      if (typeof envFileRaw === 'string') {
        envFile = [envFileRaw];
      } else if (Array.isArray(envFileRaw)) {
        envFile = envFileRaw.map((f) => String(f));
      }

      services.push({
        name,
        image: typeof imageRaw === 'string' ? imageRaw : undefined,
        build,
        ports: Array.isArray(portsRaw) ? portsRaw.map((port) => String(port)) : undefined,
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

    const envVars = { ...(config.envVars ?? {}) };

    // Check env_file references first - fail fast if missing
    const envFileErrors = this.checkEnvFileReferences(composeProject, envVars);
    if (envFileErrors.length > 0) {
      const errorMessages = envFileErrors.map((err) => {
        let msg = `env_file '${err.envFilePath}' referenced by service '${err.service}' not found`;
        if (err.templatePath) {
          const relativeTemplate = err.templatePath
            .replace(composeProject.projectPath, '')
            .replace(/^\//, '');
          msg += `. Template '${relativeTemplate}' defines variables: ${err.requiredVars.join(', ')}`;
        } else {
          msg += '. Please provide required environment variables.';
        }
        return msg;
      });
      throw new Error(`Missing env_file(s) in docker-compose:\n${errorMessages.join('\n')}`);
    }

    const envCheckResult = checkEnvRequirements(composeProject.projectPath, envVars);
    if (envCheckResult.missing.length > 0) {
      throw new Error(
        'compose env validation failed: ' +
          (envCheckResult.templateFile ?? '.env file') +
          ' is missing required variables: ' +
          envCheckResult.missing.join(', '),
      );
    }

    this.createComposeEnvFileIfMissing(composeProject.projectPath, envVars);

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
    for (const service of composeProject.services) {
      const childId = nanoid(12);
      const childName = `${parentName}/${service.name}`;
      childrenByService.set(service.name, childId);
      this.db.createProject({
        id: childId,
        name: childName,
        repoUrl: config.repoUrl,
        branch: config.branch,
        parentProjectId,
        dockerfilePath: config.composePath,
      });
      this.db.updateProject(childId, { status: 'building' });
      this.jobManager?.trackJob(childId, childName);
    }

    await this.events.emit('compose:start', {
      projectId: parentProjectId,
      composePath: config.composePath,
      serviceCount: composeProject.services.length,
    });

    try {
      this.jobManager?.updatePhase(parentProjectId, 'building');

      const conflicts = this.detectPortConflicts(composeProject);
      if (conflicts.length > 0) {
        const override = await this.generateOverride(composeProject, conflicts);
        this.writeOverride(config.composePath, override);
        log.info({ conflicts: conflicts.length }, 'Generated port conflict override');
      }

      const upResult = await this.execCompose(config.composePath, ['up', '-d', '--build']);
      buildLog += `[compose up]\n${upResult.stdout}${upResult.stderr}`;
      if (upResult.exitCode !== 0) {
        throw new Error(`docker compose failed: ${upResult.stderr || upResult.stdout}`);
      }

      this.jobManager?.updatePhase(parentProjectId, 'starting');
      const statuses = await this.getServiceStatuses(parentProjectId);

      for (const status of statuses) {
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
      }

      const hasError = statuses.some((status) => status.status === 'error');
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
          error: 'One or more services failed to start',
        });
      } else {
        await this.events.emit('compose:up', {
          projectId: parentProjectId,
          services: statuses.map((status) => status.name),
        });
      }

      this.jobManager?.updatePhase(parentProjectId, hasError ? 'failed' : 'done');

      return {
        success: !hasError,
        parentProjectId,
        parentName,
        services: statuses,
        buildDurationMs: Date.now() - startTime,
        error: hasError ? 'One or more services failed to start' : undefined,
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
        const candidate = await allocatePort(this.db, this.docker, min);
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
      envLines.push(key + '=' + this.formatComposeEnvValue(resolvedValue));
    }

    writeFileSync(envFilePath, envLines.join('\n') + '\n', 'utf8');
    log.info(
      { envFilePath, templateFile: envTemplatePath },
      'Generated compose .env file from template',
    );
  }

  private formatComposeEnvValue(value: string): string {
    if (!value) {
      return '';
    }

    if (/\s|#/.test(value)) {
      return '"' + value.replace(/"/g, '\\"') + '"';
    }

    return value;
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
