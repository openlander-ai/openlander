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
2. **Create services first** — If the app needs a database or cache:
    - \`create_service\` with template (postgresql/mysql/redis/mongodb).
    - The response includes \`suggested_env\` with the recommended env var key and connection string.
    - Call \`set_env_vars\` on the deployable service with the suggested key/value to save the binding.
3. **Deploy** — \`create_deploy_plan\` with the repo URL, then \`execute_deploy_plan\`. Add \`env_vars\` for any additional config.
4. **Monitor** — \`get_deploy_status\` to poll build progress. \`get_build_log\` for raw output if it fails.
5. **Debug failures** — \`get_build_log\` and \`get_logs\` provide evidence; analyze it in your own external agent.

## Service Auto-Link Pattern

\`\`\`
// 1. Create service
create_service({ name: "mydb", template: "postgresql" })
// Returns: { suggested_env: [{ key: "DATABASE_URL", value: "postgresql://..." }] }

// 2. Link to the deployable service
set_env_vars({ service_name: "myapp-web", variables: '{"DATABASE_URL": "postgresql://..."}' })

// 3. Redeploy to apply saved env to the running container
create_deploy_plan({ project_name: "myapp" })
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

No special configuration needed — pass them via env_vars in create_deploy_plan or save them with set_env_vars. MCP env changes are saved only by default; call deploy_service or pass defer_redeploy=false when you want to apply them to a running container.

## Deploy Triggering

OpenLander 0.1 does not expose git-provider auto-deploy webhooks. Use explicit deploys through the UI or MCP after pushing code.

${typeSpecific}`,
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
