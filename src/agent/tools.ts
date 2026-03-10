import type { AppContext } from '../app.js';
import type { QuestionBridge } from './question-bridge.js';
import { getSystemStats, formatStatsSummary } from '../monitor/stats.js';
import { ProjectNotFoundError } from '../errors.js';
import { cloneRepo } from '../pipeline/git.js';
import { getProjectUrl } from '../pipeline/traefik.js';
import { scanUsedPorts } from '../pipeline/port.js';
import { DeployOrchestrator, type ServiceNode } from '../pipeline/orchestrator.js';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createGitProvider } from '../git-providers/index.js';
import { loadConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { generateSmartDefaults } from './smart-defaults.js';
import { tool } from 'ai';
import { z } from 'zod';

const log = createModuleLogger('agent-tools');

/**
 * Tool definitions for the OpenLander agent.
 *
 * Each tool maps to a pipeline operation.
 * The LLM calls these via function calling — execution is deterministic.
 *
 * Description format (per tool-design best practice):
 *   What it does → When to use → Returns → Errors → Notes
 *
 * v0.1 tools:
 * - deploy_project: Deploy from a git repo URL
 * - stop_project: Stop a running container
 * - remove_project: Remove a project entirely
 * - get_logs: Get container logs
 * - list_projects: List all projects
 * - set_env_vars: Set environment variables
 * - expose_public: Create a TryCloudflare tunnel
 * - unexpose_public: Remove public URL
 * - get_system_stats: Host resource usage
 * v0.2 tools (new):
 * - restart_project: Restart a running container
 * - map_domain: Map a custom domain via Cloudflare
 * - list_domains: List all domain mappings
 * v0.3 tools:
 * - rollback_project: Rollback to previous image
 * - provision_database: Provision a database sidecar
 * - deploy_blue_green: Zero-downtime deployment
 * - debug_build_error: Analyze build failures with LLM
 * v0.4 tools:
 * - preview_deploy: Ephemeral branch preview
 * - cleanup_preview: Remove preview
 * - list_previews: List active previews
 */
export function createTools(ctx: AppContext, questionBridge?: QuestionBridge) {
  const tools = {
    deploy_project: tool({
      description:
        'Start deploying a project from a git repository URL. Returns immediately with { projectId, projectName, status: "building" } while the build runs in the background. ALWAYS follow up with get_deploy_status to check progress and report the result to the user. Errors: CLONE_FAILED (bad URL or private repo without SSH key), BUILD_FAILED (Dockerfile error — suggest debug_build_error next), ALREADY_EXISTS (project name taken). Only works with repos that have a Dockerfile.',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL (e.g., github.com/user/repo)'),
        branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
        name: z
          .string()
          .optional()
          .describe('Project name (auto-generated from repo if not provided)'),
      }),
      execute: async ({ repo_url, branch, name }) => {
        // v0.0.11: Smart Defaults — suggest previous settings for redeployments
        if (questionBridge) {
          const defaults = generateSmartDefaults(ctx.db, {
            repoUrl: repo_url,
            branch,
            name,
          });
          if (defaults.hasSuggestions) {
            const { nanoid } = await import('nanoid');
            const request = {
              id: nanoid(12),
              questions: [
                {
                  question: 'Found previous deployment settings. Apply these defaults?',
                  header: 'Smart Defaults',
                  options: defaults.suggestions.map((s) => ({
                    label: s.label,
                    description: s.description,
                  })),
                  multiple: true,
                },
              ],
            };
            const answers = await questionBridge.ask(request);
            log.info(
              { answers, suggestionCount: defaults.suggestions.length },
              'Smart defaults response',
            );
          }
        }

        const result = await ctx.pipeline.startDeploy({
          repoUrl: repo_url,
          branch,
          name,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          trigger: 'chat',
        });
        return { ...result, hint: 'Use get_deploy_status to check progress.' };
      },
    }),

    deploy_compose: tool({
      description:
        'Deploy a project that uses Docker Compose (multi-service). Auto-detected when compose file exists. Returns parent project with service statuses. Errors: COMPOSE_FILE_NOT_FOUND, BUILD_FAILED.',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL'),
        branch: z.string().optional().describe('Branch (default: repo default branch)'),
        name: z.string().optional().describe('Project name (auto-generated from repo if omitted)'),
      }),
      execute: async ({ repo_url, branch, name }) => {
        const cloneResult = await cloneRepo({
          repoUrl: repo_url,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });

        const composePath = ctx.composePipeline.detectComposeFile(cloneResult.path);
        if (!composePath) {
          return {
            error: 'COMPOSE_FILE_NOT_FOUND',
            message: 'No compose file found in repository.',
          };
        }

        const result = await ctx.composePipeline.deployCompose({
          repoUrl: repo_url,
          branch,
          clonePath: cloneResult.path,
          composePath,
          name,
          trigger: 'chat',
        });

        if (!result.success) {
          return {
            error: 'BUILD_FAILED',
            message: result.error ?? 'Compose deploy failed.',
            ...result,
          };
        }

        return result;
      },
    }),

    list_compose_services: tool({
      description:
        'List services in a Docker Compose project with per-service status, ports, and container IDs.',
      inputSchema: z.object({
        project_name: z.string().describe('Compose project name'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const services = await ctx.composePipeline.getServiceStatuses(project.id);
        return {
          project: project_name,
          count: services.length,
          services,
        };
      },
    }),

    stop_project: tool({
      description:
        'Stop a running project container gracefully. Use when user wants to pause or shut down a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND — use list_projects to find valid names. Does NOT remove the project; use remove_project for full cleanup.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to stop'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        await ctx.pipeline.stop(project.id);
        return { status: 'stopped', project: project_name };
      },
    }),

    remove_project: tool({
      description:
        'Permanently remove a project — deletes the container, image, and database record. DESTRUCTIVE — cannot be undone. Use only when user explicitly wants to delete a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND. To just stop without deleting, use stop_project instead.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to remove'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        await ctx.pipeline.remove(project.id, ctx.cloudflare);
        return { status: 'removed', project: project_name };
      },
    }),

    get_logs: tool({
      description:
        'Get recent container stdout/stderr logs for a project. Use when user asks about errors, crashes, or app behavior. Returns { project, logs } where logs is a string of the most recent 20 lines. Errors: PROJECT_NOT_FOUND. If logs show a build error, suggest debug_build_error for diagnosis.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project'),
        lines: z.number().optional().describe('Number of log lines to return (default: 20)'),
      }),
      execute: async ({ project_name, lines }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const logLines = lines ?? 20;
        const logs = await ctx.pipeline.getLogs(project.id, logLines);
        return { project: project_name, logs };
      },
    }),

    list_projects: tool({
      description:
        'List all deployed projects with name, status (running/stopped/error), ports, local URLs, and public URLs. Use as the first tool when user asks about their projects, or to verify a project name before other operations. Returns { count, projects[] }. Always available, no errors.',
      inputSchema: z.object({}),
      execute: () => {
        const projects = ctx.db.listProjects();
        return Promise.resolve({
          count: projects.length,
          projects: projects.map((p) => ({
            name: p.name,
            status: p.status,
            visibility: p.visibility,
            port: p.assigned_port,
            url: p.assigned_port ? getProjectUrl(p.name) : null,
            publicUrl: p.public_url,
            repoUrl: p.repo_url,
          })),
        });
      },
    }),

    set_env_vars: tool({
      description:
        'Set environment variables for a project and trigger a redeploy if running. Use when user needs to configure DATABASE_URL, API keys, or other env vars. The variables parameter must be a JSON string of key-value pairs. Returns { status, project, keys[] }. Status is "updated_and_redeployed" if project was running, "updated" otherwise. Errors: PROJECT_NOT_FOUND, JSON parse error if variables is malformed.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project'),
        variables: z
          .string()
          .describe('JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})'),
      }),
      execute: async ({ project_name, variables }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const vars = JSON.parse(variables) as Record<string, string>;
        const changed = ctx.env.setBulk(project.id, vars);

        if (changed && project.status === 'running') {
          // Redeploy with new env vars
          await ctx.pipeline.redeploy(project.id);
          return {
            status: 'updated_and_redeployed',
            project: project_name,
            keys: Object.keys(vars),
          };
        }

        return { status: 'updated', project: project_name, keys: Object.keys(vars) };
      },
    }),

    set_global_secret: tool({
      description:
        'Set a global secret that is available to all projects (stored encrypted). Use for shared API keys, database credentials, etc. that multiple projects need. Returns { status, key }.',
      inputSchema: z.object({
        key: z.string().describe('Secret name (e.g. OPENAI_API_KEY)'),
        value: z.string().describe('Secret value'),
        description: z
          .string()
          .optional()
          .describe('Optional description of what this secret is for'),
      }),
      execute: ({ key, value, description }) => {
        ctx.env.setGlobalSecret(key, value, description);
        return Promise.resolve({
          status: 'saved',
          key,
          message: `Global secret "${key}" saved (encrypted).`,
        });
      },
    }),

    list_global_secrets: tool({
      description:
        'List all global secrets (values are masked for security). Returns { secrets: [{ key, maskedValue, description }], count }.',
      inputSchema: z.object({}),
      execute: () => {
        const secrets = ctx.env.getGlobalSecretsMasked();
        return Promise.resolve({ secrets, count: secrets.length });
      },
    }),

    expose_public: tool({
      description:
        'Create a temporary public URL for a project via TryCloudflare tunnel. Use when user wants to share their app externally or test from another device. Returns { status, project, publicUrl }. The URL is temporary and changes on restart. Errors: PROJECT_NOT_FOUND, "not running" if project has no port — deploy it first. For permanent custom domains, use map_domain instead.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to expose'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);
        if (!project.assigned_port) {
          return { error: 'Project is not running — deploy it first' };
        }

        const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
        return { status: 'exposed', project: project_name, publicUrl: url };
      },
    }),

    unexpose_public: tool({
      description:
        'Remove the public TryCloudflare tunnel URL for a project. Use when user wants to make a project private again. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to unexpose'),
      }),
      execute: ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        ctx.pipeline.closeTunnel(project.id);
        return Promise.resolve({ status: 'unexposed', project: project_name });
      },
    }),

    get_system_stats: tool({
      description:
        'Get host system resource usage — CPU load, memory, and disk space. Use when user asks about server health, capacity, or before deploying to check if resources are available. Returns { summary, cpu, memory, disk } with percentage usage and warnings. Always available, no errors.',
      inputSchema: z.object({}),
      execute: () => {
        const stats = getSystemStats();
        return Promise.resolve({
          summary: formatStatsSummary(stats),
          ...stats,
        });
      },
    }),

    // --- v0.3 Tools ---
    rollback_project: tool({
      description:
        'Rollback a project to its previous Docker image. Use when a recent deploy broke something and user wants to revert. Returns the rollback result with previous image info. Errors: PROJECT_NOT_FOUND, NO_PREVIOUS_IMAGE if this is the first deploy.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to rollback'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const result = await ctx.pipeline.rollback(project.id);
        return result;
      },
    }),

    provision_database: tool({
      description:
        'Provision a database sidecar (PostgreSQL or SQLite) for a project. Automatically sets DATABASE_URL in the project env vars and redeploys. Use when user says they need a database. Defaults to PostgreSQL. Returns { status, connectionUrl, type }. Errors: PROJECT_NOT_FOUND, ALREADY_PROVISIONED.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project'),
        db_type: z
          .string()
          .optional()
          .describe('Database type: "sqlite" or "postgres" (default: postgres)'),
      }),
      execute: async ({ project_name, db_type }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const type = db_type === 'sqlite' ? 'sqlite' : 'postgres';
        const result = await ctx.dbProvisioner.provision(project.id, { type });
        return { status: 'provisioned', project: project_name, ...result };
      },
    }),

    deploy_blue_green: tool({
      description:
        'Deploy a project with zero downtime using blue-green strategy. Builds a new version alongside the current one, runs health checks, then switches traffic atomically. Use for production projects where downtime is unacceptable. Returns deployment result with old/new container info. Errors: PROJECT_NOT_FOUND, HEALTH_CHECK_FAILED (new version unhealthy — old version kept running).',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to deploy'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const result = await ctx.blueGreen.deploy(project.id);
        return result;
      },
    }),

    debug_build_error: tool({
      description:
        'Analyze a failed build and suggest fixes using AI. Matches against known error patterns first (fast), then uses LLM analysis (thorough). Use when a deploy_project call failed or user reports a build error. Returns { summary, rootCause, suggestedFixes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project with the build error'),
      }),
      execute: async ({ project_name }) => {
        if (!ctx.buildDebugger) {
          return {
            error: 'Build debugger requires an LLM provider. Configure one first.',
          };
        }

        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const lastDeploy = ctx.db.getLastDeployLog(project.id);
        if (!lastDeploy || lastDeploy.status !== 'failed') {
          return { error: 'No failed build found for this project.' };
        }

        const diagnosis = await ctx.buildDebugger.diagnose({
          buildLog: lastDeploy.build_log ?? 'No build log available',
          projectName: project_name,
          imageTag: project.image_tag ?? `openlander/${project_name}:latest`,
          failedStep: 'build',
        });

        return diagnosis;
      },
    }),

    fix_dockerfile: tool({
      description:
        'Analyze a failed build and generate a fixed Dockerfile using AI. Use when a build fails due to Dockerfile content errors (wrong Node version, missing dependencies, invalid syntax). Returns { dockerfileContent, explanation, changes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of project with Dockerfile build error'),
      }),
      execute: async ({ project_name }) => {
        if (!ctx.buildDebugger) {
          return {
            error: 'Build debugger requires an LLM provider. Configure one first.',
          };
        }

        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        const lastDeploy = ctx.db.getLastDeployLog(project.id);
        if (!lastDeploy || lastDeploy.status !== 'failed') {
          return { error: 'No failed build found for this project.' };
        }

        // Clone path is ephemeral (temp dir), so re-clone to get current Dockerfile
        const { cloneRepo: cloneForFix } = await import('../pipeline/git.js');
        const { readDockerfile } = await import('./debugger.js');
        const cloneResult = await cloneForFix({
          repoUrl: project.repo_url ?? '',
          branch: project.branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        const currentDockerfile = readDockerfile(cloneResult.path) ?? 'Not available';

        const fixResult = await ctx.buildDebugger.fixDockerfile({
          projectPath: cloneResult.path,
          currentDockerfile,
          buildError: lastDeploy.build_log ?? 'No build log available',
          projectName: project_name,
        });

        return fixResult;
      },
    }),

    // --- v0.4 Tools ---
    preview_deploy: tool({
      description:
        'Deploy an ephemeral preview environment for a specific branch. Creates a separate container that does not affect the main deployment. Use when user wants to test a PR or feature branch before merging. Returns { previewId, branch, url, port }. The preview is temporary — clean up with cleanup_preview when done.',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL'),
        branch: z.string().describe('Branch name to preview'),
      }),
      execute: async ({ repo_url, branch }) => {
        const result = await ctx.previewDeployer.deploy({
          repoUrl: repo_url,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        return result;
      },
    }),

    cleanup_preview: tool({
      description:
        'Remove an ephemeral preview deployment created by preview_deploy. Pass the preview_id that was returned. Use when testing is done or to free resources. Returns { status, previewId }. Errors: PREVIEW_NOT_FOUND if the ID is invalid.',
      inputSchema: z.object({
        preview_id: z.string().describe('Preview deployment ID to clean up'),
      }),
      execute: async ({ preview_id }) => {
        await ctx.previewDeployer.cleanup(preview_id);
        return { status: 'cleaned_up', previewId: preview_id };
      },
    }),

    list_previews: tool({
      description:
        'List all active preview deployments with branch, URL, port, and creation time. Use to check what previews exist before creating new ones or to find a preview URL. Returns { count, previews[] }. Always available, no errors.',
      inputSchema: z.object({}),
      execute: () => {
        const previews = ctx.previewDeployer.list();
        return Promise.resolve({
          count: previews.length,
          previews: previews.map((p) => ({
            branch: p.branch,
            url: p.url,
            port: p.port,
            createdAt: p.createdAt.toISOString(),
          })),
        });
      },
    }),

    // --- v0.2 Tools (added in agent enhancement) ---
    restart_project: tool({
      description:
        'Restart a running project by stopping and redeploying it with the same configuration. Use when user reports the app is hung, unresponsive, or needs a fresh start after config changes. Returns { status, project } with redeploy result. Errors: PROJECT_NOT_FOUND.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project to restart'),
      }),
      execute: async ({ project_name }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        await ctx.pipeline.stop(project.id);
        const result = await ctx.pipeline.redeploy(project.id);
        return { status: 'restarted', project: project_name, ...result };
      },
    }),

    map_domain: tool({
      description:
        'Map a custom domain to a project via Cloudflare DNS and Tunnel for a permanent public URL. Use when user wants their own domain (e.g., api.myapp.com) instead of a temporary TryCloudflare URL. Requires Cloudflare configuration. Returns { status, project, domain, url }. Errors: PROJECT_NOT_FOUND, CLOUDFLARE_NOT_CONFIGURED.',
      inputSchema: z.object({
        project_name: z.string().describe('Name of the project'),
        domain: z.string().describe('Domain to map (e.g., api.myapp.com)'),
      }),
      execute: async ({ project_name, domain }) => {
        const project = ctx.db.getProjectByName(project_name);
        if (!project) throw new ProjectNotFoundError(project_name);

        await ctx.cloudflare.createTunnel(project.id, domain);
        return {
          status: 'mapped',
          project: project_name,
          domain,
          url: `https://${domain}`,
        };
      },
    }),

    list_domains: tool({
      description:
        'List all custom domain mappings across all projects with domain name, project ID, and status. Use to check existing domain configurations. Returns { count, domains[] }. Always available, no errors.',
      inputSchema: z.object({}),
      execute: () => {
        const mappings = ctx.db.listDomainMappings();
        return Promise.resolve({
          count: mappings.length,
          domains: mappings.map((m) => ({
            domain: m.domain,
            projectId: m.project_id,
            status: m.status,
          })),
        });
      },
    }),

    get_deploy_status: tool({
      description:
        'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed) and timing. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }.',
      inputSchema: z.object({
        project_name: z
          .string()
          .optional()
          .describe('Specific project name to check. Omit for all active deploys.'),
      }),
      execute: ({ project_name }) => {
        if (project_name) {
          const project = ctx.db.getProjectByName(project_name);
          if (!project) throw new ProjectNotFoundError(project_name);
          const status = ctx.jobManager.getStatus(project.id);
          const isActive = status && status.phase !== 'done' && status.phase !== 'failed';
          return Promise.resolve({
            active: isActive ? 1 : 0,
            jobs: status
              ? [
                  {
                    name: project_name,
                    phase: status.phase,
                    elapsed: `${String(Math.round((Date.now() - status.startedAt.getTime()) / 1000))}s`,
                    error: status.errorSummary,
                  },
                ]
              : [],
          });
        }
        const jobs = ctx.jobManager.getActiveJobs();
        return Promise.resolve({
          active: jobs.length,
          jobs: jobs.map((j) => ({
            name: j.projectName,
            phase: j.phase,
            elapsed: `${String(Math.round((Date.now() - j.startedAt.getTime()) / 1000))}s`,
            error: j.errorSummary,
          })),
        });
      },
    }),

    scan_dockerfiles: tool({
      description:
        'Clone a repo and scan for all Dockerfiles. Use BEFORE deploy_project when you suspect a monorepo (multiple services). Returns paths like ["Dockerfile", "frontend/Dockerfile", "backend/Dockerfile"]. If only one Dockerfile is found, use deploy_project normally. If multiple are found, deploy each as a child project with the dockerfile_path parameter. Errors: CLONE_FAILED.',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL to scan'),
        branch: z.string().optional().describe('Branch to scan (default: repo default branch)'),
      }),
      execute: async ({ repo_url, branch }) => {
        const cloneResult = await cloneRepo({
          repoUrl: repo_url,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        const dockerfiles = findDockerfiles(cloneResult.path);
        const relativePaths = dockerfiles.map((f) => relative(cloneResult.path, f));
        return {
          repoUrl: repo_url,
          clonePath: cloneResult.path,
          commitSha: cloneResult.commitSha,
          dockerfiles: relativePaths,
          isMonorepo: relativePaths.length > 1,
        };
      },
    }),

    deploy_monorepo: tool({
      description:
        'Start deploying a monorepo with multiple services in the background. Use AFTER scan_dockerfiles confirms multiple Dockerfiles. Returns immediately with { parentProjectId, parentName, status: "building" } while all services build in parallel. Use get_deploy_status to check progress. Errors: BUILD_FAILED on individual services (others continue).',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL'),
        clone_path: z.string().describe('Path to already-cloned repo (from scan_dockerfiles)'),
        commit_sha: z.string().describe('Commit SHA (from scan_dockerfiles)'),
        dockerfiles: z
          .string()
          .describe(
            'JSON array of Dockerfile paths (from scan_dockerfiles), e.g. ["frontend/Dockerfile", "backend/Dockerfile"]',
          ),
        branch: z.string().optional().describe('Branch (default: repo default branch)'),
      }),
      execute: ({ repo_url, clone_path, commit_sha, dockerfiles, branch }) => {
        const dockerfileList = JSON.parse(dockerfiles) as string[];
        const result = ctx.pipeline.startMonorepoDeploy({
          repoUrl: repo_url,
          clonePath: clone_path,
          commitSha: commit_sha,
          dockerfiles: dockerfileList,
          branch,
        });
        return Promise.resolve({
          ...result,
          hint: 'Use get_deploy_status to check progress.',
        });
      },
    }),

    orchestrate_deploy: tool({
      description:
        'Deploy multiple services with dependency ordering and atomic rollback. Use for monorepos or multi-service repos. Internally scans Dockerfiles, reads compose depends_on when available, deploys in topological order, and rolls back all deployed services if any step fails.',
      inputSchema: z.object({
        repo_url: z.string().describe('Git repository URL'),
        branch: z.string().optional().describe('Branch (default: repo default branch)'),
      }),
      execute: async ({ repo_url, branch }) => {
        const cloneResult = await cloneRepo({
          repoUrl: repo_url,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });

        const dockerfiles = findDockerfiles(cloneResult.path).map((filePath) =>
          relative(cloneResult.path, filePath),
        );

        const composePath = ctx.composePipeline.detectComposeFile(cloneResult.path);
        const composeProject = composePath
          ? ctx.composePipeline.parseComposeFile(composePath)
          : null;

        const services = buildServiceNodes(
          cloneResult.path,
          dockerfiles,
          composeProject?.services ?? [],
        );
        const orchestrator = new DeployOrchestrator();
        const topology = orchestrator.buildTopology(
          services,
          repo_url,
          cloneResult.path,
          cloneResult.commitSha,
          branch,
        );

        const usedPorts = (await scanUsedPorts(ctx.db, ctx.docker)).all;
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

            const monorepoResult = await ctx.pipeline.deployMonorepo({
              repoUrl: repo_url,
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
            await ctx.pipeline.rollback(service.projectId);
          },
        });
      },
    }),

    // --- Git Provider Tools ---
    list_github_repos: tool({
      description:
        'List repositories from the user\'s connected GitHub account, sorted by most recently pushed. Use when user asks "show my repos", "what can I deploy?", or needs to find a project by name. Returns { count, repos[] } with name, description, language, private flag, and clone URL. Errors: GITHUB_NOT_CONFIGURED if no GitHub token is set — tell user to add one in settings. Supports pagination with page parameter.',
      inputSchema: z.object({
        page: z
          .number()
          .optional()
          .describe('Page number for pagination (default: 1, 30 repos per page)'),
        visibility: z
          .string()
          .optional()
          .describe('Filter by visibility: "all", "public", or "private" (default: all)'),
      }),
      execute: async ({ page, visibility }) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to browse repos.',
          };
        }
        const provider = createGitProvider('github', ghConfig);
        const pageNum = page ?? 1;
        const visibilityFilter = (visibility as 'all' | 'public' | 'private' | undefined) ?? 'all';
        const result = await provider.listRepos({
          page: pageNum,
          perPage: 30,
          visibility: visibilityFilter,
        });
        return {
          count: result.repos.length,
          hasMore: result.hasMore,
          repos: result.repos.map((r) => ({
            name: r.name,
            fullName: r.fullName,
            description: r.description,
            language: r.language,
            private: r.isPrivate,
            defaultBranch: r.defaultBranch,
            stars: r.stars,
            cloneUrl: r.isPrivate ? provider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
            htmlUrl: r.htmlUrl,
            updatedAt: r.updatedAt,
          })),
        };
      },
    }),

    search_github_repos: tool({
      description:
        'Search the user\'s GitHub repositories by name or keyword. Use when user says "deploy my-project" or "find repo X" — this resolves a project name to a deployable repo URL. Returns { total, repos[] } with clone URLs ready for deploy_project. Errors: GITHUB_NOT_CONFIGURED. Tip: after finding the repo, call deploy_project with the clone URL.',
      inputSchema: z.object({
        query: z.string().describe('Search query — matches repo name, description, and README'),
      }),
      execute: async ({ query }) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to search repos.',
          };
        }
        const provider = createGitProvider('github', ghConfig);
        const result = await provider.searchRepos(query);
        return {
          total: result.total,
          repos: result.repos.map((r) => ({
            name: r.name,
            fullName: r.fullName,
            description: r.description,
            language: r.language,
            private: r.isPrivate,
            defaultBranch: r.defaultBranch,
            cloneUrl: r.isPrivate ? provider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
            htmlUrl: r.htmlUrl,
          })),
        };
      },
    }),

    // --- v0.5 Tools: Alerts ---
    get_alerts: tool({
      description:
        'Get current system alerts for resource issues, inactive projects, and container problems. Returns active alerts with severity, message, and suggested actions. Use when user asks about system health, problems, or "show alerts". Always available.',
      inputSchema: z.object({}),
      execute: () => {
        const alerts = ctx.alertMonitor.getActiveAlerts();
        return Promise.resolve({
          count: alerts.length,
          alerts: alerts.map((a) => ({
            id: a.id,
            type: a.type,
            severity: a.severity,
            message: a.message,
            suggestion: a.suggestion,
            createdAt: a.createdAt.toISOString(),
          })),
        });
      },
    }),

    dismiss_alert: tool({
      description:
        'Dismiss a specific alert by ID so it no longer appears in active alerts. Use when user acknowledges an alert. Returns { status, alertId }.',
      inputSchema: z.object({
        alert_id: z.string().describe('Alert ID to dismiss'),
      }),
      execute: ({ alert_id }) => {
        ctx.alertMonitor.dismissAlert(alert_id);
        return Promise.resolve({ status: 'dismissed', alertId: alert_id });
      },
    }),
  };

  // Conditionally add ask_user_question tool if questionBridge is provided
  if (questionBridge) {
    return {
      ...tools,
      ask_user_question: tool({
        description:
          "Ask the user a question with structured choices during a conversation. Use when you need to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer options. Each question has a header (max 30 chars), a question string, and an array of options with label (1-5 words) and description. A 'Type your own answer' option is automatically added. If you recommend a specific option, list it first and add '(Recommended)' to its label. Set multiple=true to allow multi-select. Returns an array of answers, each with selectedLabels (array of chosen label strings) and optional customText.",
        inputSchema: z.object({
          questions: z
            .string()
            .describe(
              'JSON array of question objects. Each: { question: string, header?: string (max 30 chars), options: [{ label: string (1-5 words), description?: string }], multiple?: boolean }',
            ),
        }),
        execute: async ({ questions }) => {
          const questionsParsed = JSON.parse(questions) as Array<{
            question: string;
            header?: string;
            options: Array<{ label: string; description?: string }>;
            multiple?: boolean;
          }>;
          const { nanoid } = await import('nanoid');
          const request = {
            id: nanoid(12),
            questions: questionsParsed.map((q) => ({
              question: q.question,
              header: q.header?.slice(0, 30),
              options: q.options.map((o) => ({
                label: o.label.slice(0, 30),
                description: o.description,
              })),
              multiple: q.multiple ?? false,
            })),
          };
          const answers = await questionBridge.ask(request);
          if (answers.length === 0) {
            return {
              dismissed: true,
              message: 'User dismissed the question without answering.',
            };
          }
          return {
            answers: answers.map((a) => ({
              questionIndex: a.questionIndex,
              selectedLabels: a.selectedLabels,
              customText: a.customText,
            })),
          };
        },
      }),
    };
  }

  return tools;
}

function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (err) {
      log.debug({ err, current }, 'Failed to read directory during Dockerfile scan');
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') continue;
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
        continue;
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
