import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { ProjectNotFoundError } from '../../errors.js';
import { cloneRepo } from '../../pipeline/git.js';
import { scanUsedPorts } from '../../pipeline/port.js';
import { filterServicesByProfiles } from '../../pipeline/compose.js';
import { DeployOrchestrator, type ServiceNode } from '../../pipeline/orchestrator.js';
import { resolveEnvVars } from '../../pipeline/resolve-env.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { ToolDef } from './types.js';
import {
  deployComposeSchema,
  listComposeServicesSchema,
  orchestrateDeploySchema,
} from './schemas.js';

const log = createModuleLogger('tools-defs-compose');

const deployComposeInputSchema = deployComposeSchema.extend({
  name: z.string().optional().describe('Project name (auto-generated from repo if omitted)'),
  profiles: z
    .array(z.string())
    .optional()
    .describe('Docker Compose profiles to activate (e.g., ["infra", "dev"])'),
});

const orchestrateDeployInputSchema = orchestrateDeploySchema.extend({
  profiles: z
    .array(z.string())
    .optional()
    .describe('Docker Compose profiles to activate (e.g., ["infra", "dev"])'),
});

export const composeToolDefs: ToolDef[] = [
  {
    name: 'deploy_compose',
    description:
      'Deploy a project that uses Docker Compose (multi-service). Auto-detected when compose file exists. Returns parent project with service statuses. Errors: COMPOSE_FILE_NOT_FOUND, BUILD_FAILED.',
    mcpDescription: 'Deploy services from a Docker Compose repository.',
    inputSchema: deployComposeInputSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = args['branch'] as string | undefined;
      const name = args['name'] as string | undefined;
      const profiles = args['profiles'] as string[] | undefined;

      const cloneResult = await cloneRepo({
        repoUrl,
        branch,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
      });

      const composePath = appCtx.composePipeline.detectComposeFile(cloneResult.path);
      if (!composePath) {
        throw new Error('COMPOSE_FILE_NOT_FOUND: No compose file found in repository.');
      }

      const existingProject = name ? appCtx.db.getProjectByName(name) : undefined;
      const envVars = existingProject
        ? resolveEnvVars({ projectId: existingProject.id }, { env: appCtx.env })
        : appCtx.env.getGlobalSecrets();

      const result = await appCtx.composePipeline.deployCompose({
        repoUrl,
        branch,
        clonePath: cloneResult.path,
        composePath,
        name,
        profiles,
        envVars,
        trigger: 'chat',
      });

      if (!result.success) {
        let composeContent = '';
        try {
          composeContent = readFileSync(composePath, 'utf8');
        } catch (error) {
          log.warn({ err: error, composePath }, 'Failed to read compose file after deploy failure');
        }
        return {
          ...result,
          error: 'BUILD_FAILED',
          message: result.error ?? 'Compose deploy failed.',
          composePath,
          composeContent,
          _agent_guidance: {
            next_steps: [
              'Check composeContent for configuration issues',
              'Call get_build_log for raw build output',
              'Call debug_build_error for AI diagnosis',
              'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
            ],
          },
        };
      }

      return result;
    },
    targets: ['agent'],
  },
  {
    name: 'list_compose_services',
    description:
      'List services in a Docker Compose project with per-service status, ports, and container IDs.',
    mcpDescription: 'List compose services with per-service status and ports.',
    inputSchema: listComposeServicesSchema,
    execute: (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const services = appCtx.composePipeline.getServiceStatuses(project.id);
      return {
        project: projectName,
        count: services.length,
        services,
      };
    },
    targets: ['agent'],
  },
  {
    name: 'orchestrate_deploy',
    description:
      'Deploy multiple services with dependency ordering and atomic rollback. Use for monorepos or multi-service repos. Internally scans Dockerfiles, reads compose depends_on when available, deploys in topological order, and rolls back all deployed services if any step fails.',
    mcpDescription: 'Deploy monorepo services in dependency order with atomic rollback.',
    inputSchema: orchestrateDeployInputSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = args['branch'] as string | undefined;
      const profiles = args['profiles'] as string[] | undefined;

      const cloneResult = await cloneRepo({
        repoUrl,
        branch,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
      });

      const dockerfiles = findDockerfiles(cloneResult.path).map((filePath) =>
        relative(cloneResult.path, filePath),
      );

      const composePath = appCtx.composePipeline.detectComposeFile(cloneResult.path);
      const composeProject = composePath
        ? appCtx.composePipeline.parseComposeFile(composePath)
        : null;

      const filteredComposeServices = filterServicesByProfiles(
        composeProject?.services ?? [],
        profiles,
      );

      const services = buildServiceNodes(cloneResult.path, dockerfiles, filteredComposeServices);
      const orchestrator = new DeployOrchestrator();
      const topology = orchestrator.buildTopology(
        services,
        repoUrl,
        cloneResult.path,
        cloneResult.commitSha,
        branch,
      );

      const usedPorts = (await scanUsedPorts(appCtx.db, appCtx.docker)).all;
      const validation = orchestrator.validateTopology(topology, usedPorts);
      if (!validation.valid) {
        return {
          success: false,
          services: services.map((service) => ({
            name: service.name,
            status: 'failed' as const,
            error: validation.errors.join('; '),
          })),
          totalDuration: 0,
          error: 'TOPOLOGY_VALIDATION_FAILED',
          validationErrors: validation.errors,
        };
      }

      const deploymentCache = new Map<
        string,
        { success: boolean; projectId?: string; url?: string; error?: string }
      >();

      return orchestrator.executeOrdered(topology, {
        deployService: async (service) => {
          const cached = deploymentCache.get(service.name);
          if (cached) {
            return cached;
          }

          if (!service.dockerfile) {
            const failed = {
              success: false,
              error: `Service ${service.name} has no Dockerfile path`,
            };
            deploymentCache.set(service.name, failed);
            return failed;
          }

          const monorepoResult = await appCtx.pipeline.deployMonorepo({
            repoUrl,
            branch,
            clonePath: cloneResult.path,
            commitSha: cloneResult.commitSha,
            dockerfiles: [service.dockerfile],
            envVars: service.envVars,
            trigger: 'chat',
          });

          const childResult = monorepoResult.children[0];
          if (!childResult) {
            const failed = {
              success: false,
              error: `No deploy result returned for service ${service.name}`,
            };
            deploymentCache.set(service.name, failed);
            return failed;
          }

          const result = {
            success: childResult.success,
            projectId: childResult.projectId,
            url: childResult.url,
            error: childResult.error,
          };
          deploymentCache.set(service.name, result);
          return result;
        },
        rollbackService: async (service) => {
          if (!service.projectId) {
            return;
          }
          await appCtx.pipeline.rollback(service.projectId);
        },
      });
    },
    targets: ['agent'],
  },
];

function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (err) {
      log.debug({ err, current }, 'Failed to read directory during Dockerfile scan');
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') {
        continue;
      }

      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === 'Dockerfile') {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch (err) {
        log.debug({ err, fullPath }, 'Failed to stat file during Dockerfile scan');
      }
    }
  }

  walk(dir, 0);
  return results;
}

function buildServiceNodes(
  clonePath: string,
  dockerfiles: string[],
  composeServices: Array<{
    name: string;
    build?: string | { context: string; dockerfile?: string };
    dependsOn?: string[];
    ports?: string[];
    environment?: Record<string, string> | string[];
  }>,
): ServiceNode[] {
  const composeByName = new Map(composeServices.map((service) => [service.name, service]));
  const composeByDockerfile = new Map<string, (typeof composeServices)[number]>();

  for (const service of composeServices) {
    const dockerfilePath = deriveDockerfileFromComposeBuild(service.build);
    if (!dockerfilePath) {
      continue;
    }
    composeByDockerfile.set(
      normalizeRelativePath(join(clonePath, dockerfilePath), clonePath),
      service,
    );
  }

  return dockerfiles.map((dockerfilePath) => {
    const normalizedDockerfile = normalizeRelativePath(join(clonePath, dockerfilePath), clonePath);
    const serviceName = deriveServiceName(dockerfilePath);
    const composeService =
      composeByName.get(serviceName) ?? composeByDockerfile.get(normalizedDockerfile);
    const envVars = parseComposeEnvVars(composeService?.environment);

    return {
      name: composeService?.name ?? serviceName,
      dockerfile: dockerfilePath,
      dependsOn: composeService?.dependsOn ?? [],
      port: parseComposeHostPort(composeService?.ports?.[0]),
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    };
  });
}

function deriveServiceName(dockerfilePath: string): string {
  const normalized = dockerfilePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return 'app';
  }
  return parts[parts.length - 2] ?? 'app';
}

function parseComposeHostPort(portMapping?: string): number | undefined {
  if (!portMapping) {
    return undefined;
  }
  const cleaned = portMapping.trim().split('/')[0] ?? portMapping;
  const tokens = cleaned
    .split(':')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length < 2) {
    return undefined;
  }
  const hostPortToken = tokens[tokens.length - 2];
  if (!hostPortToken || !/^\d+$/.test(hostPortToken)) {
    return undefined;
  }
  const parsed = Number(hostPortToken);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseComposeEnvVars(
  environment?: Record<string, string> | string[],
): Record<string, string> {
  if (!environment) {
    return {};
  }
  if (!Array.isArray(environment)) {
    return { ...environment };
  }
  const vars: Record<string, string> = {};
  for (const item of environment) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    vars[key] = value;
  }
  return vars;
}

function deriveDockerfileFromComposeBuild(
  build?: string | { context: string; dockerfile?: string },
): string | null {
  if (!build) {
    return null;
  }
  if (typeof build === 'string') {
    return join(build, 'Dockerfile');
  }
  return join(build.context, build.dockerfile ?? 'Dockerfile');
}

function normalizeRelativePath(pathToNormalize: string, root: string): string {
  return relative(root, pathToNormalize).replace(/\\/g, '/');
}
