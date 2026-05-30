import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>,
  ) => Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

const PROMPTS: PromptDef[] = [
  {
    name: 'deployment-guide',
    description:
      'Recommended deployment workflow for OpenLander. Covers the step-by-step flow, service linking pattern, common mistakes, and env var conventions.',
    arguments: [
      {
        name: 'project_type',
        description:
          'Project type for tailored advice (e.g. nextjs, fastapi, rails, spring-boot, generic)',
        required: false,
      },
    ],
    getMessages: (args) => {
      const projectType = args['project_type'] ?? 'generic';
      const typeSpecific = getTypeSpecificAdvice(projectType);

      return [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are helping a user deploy a ${projectType} project with OpenLander. Follow this guide:

## Recommended Deployment Flow

1. **Preflight** — Call \`get_system_stats\` to check disk/memory.
2. **Deploy** — For the common single-service case, \`deploy_app\` is the one-call front door: pass \`repo_url\` (or \`image\`) + \`name\` for a new app, or \`service_id\`/\`service_name\` to redeploy an existing one. For multi-service stacks or when you want to inspect before executing, use \`create_deploy_plan\` then \`execute_deploy_plan\`. Add \`env_vars\` for additional config.
3. **Approve proposed managed services** — When a plan would auto-provision a project-scoped managed service (e.g. a \`postgresql\` it can wire to \`DATABASE_URL\`), \`execute_deploy_plan\` returns status \`needs_approval\` with \`approval_required.create_resources\` and creates nothing. Re-run with \`approve_all_safe_resources: true\` (approve all) or \`approvals.create_resources: ["postgresql", ...]\` (approve specific identifiers). Auto-provisioning works only for an **existing** project — a brand-new app returns \`needs_target_project\`, so deploy the app first to create the project, then approve the managed service on it (or pass an external \`<ENV>_URL\` in \`env_vars\`).
4. **Link a service manually (alternative)** — For compose stacks, not-auto-creatable services, or an external/shared dependency: \`create_service\` (template + \`project_id\`/\`project_name\`) returns \`suggested_env\`; call \`set_env_vars\` on the deployable service with it, then redeploy.
5. **Monitor** — Behavior depends on the path. A **new-app** \`deploy_app\` blocks until terminal by default (\`wait: true\`) and returns the final result; pass \`wait: false\` to return immediately. But when \`deploy_app\` resolves to an **existing** service (\`service_id\`/\`service_name\`, or a single-service \`name\`) it delegates to \`redeploy_app\` and returns \`deploying\` immediately — non-blocking, like \`execute_deploy_plan\`. For every non-blocking path, poll \`get_deploy_status\` until terminal. \`get_build_log\` for raw output if it fails.
6. **On failure** — use the \`recover-failed-deploy\` prompt: gather evidence (\`get_build_log\`, \`get_logs\`, \`diagnose_service\`, \`diagnose_host_resources\`), apply the fix, and \`redeploy_app\`.

## Manual Service-Link Pattern (alternative to step 3 auto-provisioning)

\`\`\`
// 1. Create service
create_service({ name: "mydb", template: "postgresql", project_name: "myapp" })
// Returns: { suggested_env: [{ key: "DATABASE_URL", value: "postgresql://..." }] }

// 2. Link to the deployable service
set_env_vars({ service_name: "myapp-web", variables: '{"DATABASE_URL": "postgresql://..."}' })

// 3. Redeploy to apply saved env to the running container
create_deploy_plan({ name: "myapp", repo_url: "https://github.com/user/repo" })
execute_deploy_plan({ plan_id: "..." })
\`\`\`

## Env Var Conventions

| Service Type | Default Key     | Connection String Format                          |
|-------------|-----------------|---------------------------------------------------|
| postgresql  | DATABASE_URL    | postgresql://user:pass@ol-svc-NAME:5432/db        |
| mysql       | DATABASE_URL    | mysql://user:pass@ol-svc-NAME:3306/db             |
| redis       | REDIS_URL       | redis://ol-svc-NAME:6379                          |
| mongodb     | MONGODB_URL     | mongodb://user:pass@ol-svc-NAME:27017/admin       |

- The hostname in connection strings is the container name (\`ol-svc-*\`), NOT localhost.
- For host services outside Docker, use \`host.docker.internal\` as hostname.
- Second service of the same type gets a prefixed key (e.g. \`ANALYTICS_DATABASE_URL\`).
- Env vars belong to deployable services. Use \`service_id\` or \`service_name\`; \`project_name\` is only a shortcut for groups with exactly one deployable service.

## Common Mistakes

1. **Using localhost in connection strings** — Containers can't reach the host via localhost. Use the container name (\`ol-svc-*\`) for OpenLander services.
2. **Forgetting to apply saved env changes** — MCP \`set_env_vars\` saves only by default. Redeploy afterward, or pass \`defer_redeploy=false\` when immediate apply is intentional.
3. **Deploying without Dockerfile** — OpenLander auto-generates one for known frameworks, but custom projects need a Dockerfile.
4. **Ignoring preflight failures** — \`create_deploy_plan\` runs preflight checks. If port or name conflicts exist, resolve them first.
5. **Not checking build logs on failure** — Always call \`get_build_log\` before asking the user to debug.

## Build-Time Environment Variables

OpenLander auto-detects environment variables that need to be available at Docker build time.
Variables with these prefixes are automatically injected as Docker build args:
- NEXT_PUBLIC_* (Next.js)
- VITE_* (Vite)
- REACT_APP_* (Create React App)
- NUXT_PUBLIC_* (Nuxt)
- PUBLIC_* (SvelteKit/general)
- GATSBY_* (Gatsby)

No special configuration needed — pass them via env_vars in create_deploy_plan or save them with set_env_vars. MCP env changes are saved only by default; call redeploy_app or pass defer_redeploy=false when you want to apply them to a running container.

## Deploy Triggering

OpenLander 0.1 does not expose git-provider auto-deploy webhooks. Use explicit deploys through the UI or MCP after pushing code.

${typeSpecific}`,
          },
        },
      ];
    },
  },
  {
    name: 'recover-failed-deploy',
    description:
      'Recovery workflow for a failed or unhealthy OpenLander deployment. Covers evidence gathering, failure-phase classification, the fix-and-redeploy loop, rollback vs redeploy, and the human-only safety gates.',
    arguments: [
      {
        name: 'failure_type',
        description:
          'Failure category for tailored advice (build, oom, healthcheck, runtime, image_pull)',
        required: false,
      },
    ],
    getMessages: (args) => {
      const failureType = args['failure_type'] ?? 'generic';
      const failureSpecific = getRecoveryAdvice(failureType);

      return [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are diagnosing and recovering a failed or unhealthy OpenLander deployment. OpenLander 0.1 does not run AI remediation itself — you (the external MCP agent) read the evidence, decide the fix, and call the action. Work this loop:

## Recovery Loop

1. **Locate the failure** — \`get_deploy_status\`. Pass \`deploy_id\`/\`job_id\` to tell a *completed* deploy from an unknown id (unknown ids return \`status:"not_found"\` instead of an empty "no active jobs" list). Identify which phase failed: \`clone\`, \`image_pull\`, \`build\`, \`container_start\`, or \`healthcheck_wait\`.
2. **Gather evidence (all read-only)**:
    - \`get_build_log\` — clone / image / build failures. Pass \`deploy_id\`, or \`project_name\` + \`deploy_index\` (0 = latest).
    - \`get_logs\` — runtime crashes that happen *after* the container started.
    - \`diagnose_service\` — combined health + recent logs for a deployable service. Prefer \`service_id\`; pass \`path\` to probe a specific route.
    - \`diagnose_host_resources\` — run this BEFORE falling back to SSH/Docker whenever logs show \`SIGKILL\`, OOM, disk pressure, or Docker daemon instability.
3. **Decide the fix** from the failed phase (table below).
4. **Apply the smallest fix**, then:
    - \`redeploy_app\` for code/config fixes (add \`no_cache:true\` when a dependency or lockfile changed but the build still reuses stale layers).
    - \`set_env_vars\` then \`redeploy_app\` for missing/incorrect env (MCP env writes save-only by default — redeploy to apply, or pass \`defer_redeploy:false\`).
    - \`update_service_config\` for Dockerfile path / build target / build context fixes.
    - \`rollback_service\` to get the app back up fast when the new build is broken. NOTE: rollback is **image-only** — it does NOT restore databases, volumes, env vars, or service config.
5. **Confirm — do not trust the execute call.** \`execute_deploy_plan\` and \`redeploy_app\` are non-blocking. Poll \`get_deploy_status\` until terminal, then \`diagnose_service\` (or \`probe_host\`) to confirm health. Follow \`status_call\` / \`diagnostic_call\` links in responses when present.

## Failure Phase → First Move

| Phase             | Likely cause                                  | First action                                                                 |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| clone             | bad repo_url / branch / private auth          | verify \`repo_url\` + \`branch\`, then re-run the deploy                          |
| image_pull        | wrong image ref / private registry            | fix the image ref (private registries are roadmap, not 0.1)                  |
| build             | Dockerfile / deps / missing build-arg env     | \`get_build_log\`; fix Dockerfile or build-time env; redeploy \`no_cache:true\`   |
| container_start   | bad CMD / missing runtime env / port mismatch | \`get_logs\`; fix CMD / env / port; \`redeploy_app\`                              |
| healthcheck_wait  | slow boot / wrong health path / crash on boot | \`diagnose_service\` with \`path\`; fix the health path or the boot crash         |
| (process killed)  | host OOM / disk pressure                      | \`diagnose_host_resources\`; free resources or lower the workload, then redeploy |

## Safety Gates (do not flail against these)

- \`archive_project\`, \`unarchive_project\`, \`remove_service\`, \`delete_app\`, \`delete_project\`, \`purge_project\`, and hard-delete aliases are **human-UI-only** and return \`HUMAN_UI_ONLY\` / \`OPERATION_REQUIRES_HUMAN_UI\`. Project groups can span multiple deployable services; surface the web-UI Danger-zone path for whole-group lifecycle changes. Do **not** substitute \`remove_service\` or \`cleanup_docker\` (those target managed infrastructure, not deployable apps).
- \`archive_service\` is the MCP-safe cleanup path for a deployable app/worker. \`unarchive_service\` restores an archived deployable without redeploying it. Both enter the **human approval queue** before executing — poll \`mcp_action_status\` with the returned \`action_run_id\`.
- Other destructive actions that remain exposed (e.g. \`bulk_delete_env_vars confirm=true\`) also enter the **human approval queue** before executing.
- Prefer \`service_id\` for every follow-up action. \`project_name\` only resolves when the group has exactly one deployable service.

## Common Mistakes

1. **Reporting success off the execute call** — it is non-blocking; the build may still fail. Always poll \`get_deploy_status\`.
2. **Rolling back to "fix" an env/DB problem** — rollback restores only the image. If the cause is env / volume / config, fix that and \`redeploy_app\`.
3. **SSHing for OOM before \`diagnose_host_resources\`** — the diagnosis is read-only and usually sufficient.
4. **Asking the user to read logs you never fetched** — pull \`get_build_log\` / \`get_logs\` and analyze them yourself first.

${failureSpecific}`,
          },
        },
      ];
    },
  },
];

function getTypeSpecificAdvice(projectType: string): string {
  switch (projectType.toLowerCase()) {
    case 'nextjs':
    case 'next':
      return `## Next.js Tips
- Use \`docker_target: "runner"\` for multi-stage Dockerfiles with standalone output.
- \`NEXT_PUBLIC_*\` env vars are automatically injected as Docker build args — just pass them via env_vars.
- Standalone output mode (\`output: 'standalone'\` in next.config) produces smaller images.`;

    case 'fastapi':
    case 'python':
      return `## FastAPI / Python Tips
- Ensure Dockerfile installs dependencies with \`pip install --no-cache-dir -r requirements.txt\`.
- Use \`uvicorn\` as the CMD, binding to \`0.0.0.0\` (not 127.0.0.1).
- DATABASE_URL format for SQLAlchemy: \`postgresql+asyncpg://...\` (add driver suffix).`;

    case 'rails':
    case 'ruby':
      return `## Rails Tips
- Set \`RAILS_ENV=production\` and \`SECRET_KEY_BASE\` in env vars.
- Run \`rails db:migrate\` as part of the Dockerfile or entrypoint.
- Use \`DATABASE_URL\` — Rails auto-parses it in database.yml.`;

    case 'spring-boot':
    case 'spring':
    case 'java':
      return `## Spring Boot Tips
- Use multi-stage Docker build: build with Maven/Gradle, run with JRE-only image.
- Set \`SPRING_DATASOURCE_URL\` for JDBC connections (format: \`jdbc:postgresql://host:port/db\`).
- Memory: set \`JAVA_OPTS=-Xmx512m\` to limit heap in container environments.`;

    default:
      return '';
  }
}

function getRecoveryAdvice(failureType: string): string {
  switch (failureType.toLowerCase()) {
    case 'build':
      return `## Build-Failure Tips
- Read \`get_build_log\` to the actual error line; the failing phase marker (\`build\`) narrows it.
- Missing build-time env? Prefixes \`NEXT_PUBLIC_*\`, \`VITE_*\`, \`REACT_APP_*\`, \`NUXT_PUBLIC_*\`, \`PUBLIC_*\`, \`GATSBY_*\` are auto-injected as Docker build args — set them via \`set_env_vars\` and redeploy.
- Dependency/lockfile changed but the build reused old layers? \`redeploy_app\` with \`no_cache:true\`.
- Wrong Dockerfile or build target? \`update_service_config\` (\`dockerfile_path\`, \`docker_target\`, \`build_context\`).`;

    case 'oom':
    case 'sigkill':
    case 'memory':
      return `## OOM / SIGKILL Tips
- Run \`diagnose_host_resources\` first (read-only): it reports top CPU/memory containers and Docker disk totals.
- If disk is the pressure, \`get_disk_usage\` to confirm. Reclaiming space (\`cleanup_docker\`) is **human-UI / host-maintenance only** and is blocked over MCP (\`OPERATION_REQUIRES_HUMAN_UI\`) — surface it to the user instead of calling it.
- If a single container is the cause, lower its memory footprint (e.g. \`JAVA_OPTS=-Xmx512m\`) via \`set_env_vars\` and redeploy.`;

    case 'healthcheck':
    case 'health':
      return `## Health-Check Tips
- \`diagnose_service\` with an explicit \`path\` (it falls back to a base-path env such as \`NEXT_PUBLIC_BASE_PATH\` then the service health path).
- App binds to 127.0.0.1 instead of 0.0.0.0? It will never pass the container health check — fix the bind address.
- Slow boot? The wait can expire before the app is ready; confirm the app starts cleanly via \`get_logs\` before assuming a crash.`;

    case 'runtime':
    case 'crash':
      return `## Runtime-Crash Tips
- \`get_logs\` for the post-start failure; the container started, so the build is fine — the issue is config/runtime.
- Missing or wrong connection string is the usual cause. Connection hosts are container names (\`ol-svc-*\`), not \`localhost\`.
- Verify dependency reachability with \`probe_host\` (\`internal:true\` + service/project context to probe from the isolated project network).`;

    case 'image_pull':
    case 'image':
      return `## Image-Pull Tips
- Confirm the image reference and tag exist and are public. Private registries (ECR / Artifact Registry / generic OCI auth) are roadmap, not 0.1.
- For a git-based service that should build rather than pull, re-create the plan with \`source:"git"\` and \`repo_url\`.`;

    default:
      return '';
  }
}

interface PromptRequestHandlerServer {
  setRequestHandler(
    schema: unknown,
    handler: (request: { params: Record<string, unknown> }) => unknown,
  ): void;
}

export function registerMcpPrompts(server: PromptRequestHandlerServer): void {
  server.setRequestHandler(ListPromptsRequestSchema, () => {
    return Promise.resolve({
      prompts: PROMPTS.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    });
  });

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const name = request.params['name'] as string;
    const args = (request.params['arguments'] as Record<string, string> | undefined) ?? {};

    const prompt = PROMPTS.find((p) => p.name === name);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
    }

    return Promise.resolve({
      messages: prompt.getMessages(args),
    });
  });
}
