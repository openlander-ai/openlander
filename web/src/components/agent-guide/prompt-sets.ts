export type AgentGuideKind =
  | 'add-service'
  | 'add-managed-db'
  | 'add-domain'
  | 'scale-service'
  // v5.1 (dead-button audit follow-up): destructive + generative actions
  // that should also route through the agent for the same reasons as the
  // four kinds above (single source of truth, reasoning trail, honest UX).
  | 'delete-service'
  | 'remove-domain'
  | 'set-env-var'
  | 'delete-env-var'
  | 'wire-managed-db';

export interface AgentGuidePrompt {
  text: string;
  hint?: string;
}

export interface AgentGuideContent {
  heading: string;
  lead: string;
  prompts: AgentGuidePrompt[];
}

export interface AgentGuideContext {
  projectName?: string;
  serviceName?: string;
  /** Optional env var key context — used by set-env-var / delete-env-var prompts. */
  envVarKey?: string;
  /** Optional domain context — used by remove-domain prompts. */
  domain?: string;
  /** Optional managed-service name context — used by wire-managed-db prompts. */
  managedServiceName?: string;
}

export function getAgentGuideContent(
  kind: AgentGuideKind,
  ctx: AgentGuideContext = {},
): AgentGuideContent {
  const projectName = ctx.projectName ?? 'your-project';
  const serviceName = ctx.serviceName ?? 'your-service';

  switch (kind) {
    case 'add-service':
      return {
        heading: 'Tell your agent what to deploy',
        lead: 'A Project is the workspace; Applications and Compose stacks are the workloads inside it. Paste a prompt and your agent will deploy through MCP.',
        prompts: [
          {
            text: `Deploy github.com/myorg/myapp to Project ${projectName} as a new Application.`,
          },
          {
            text: `Add a PostgreSQL Database resource, then wire DATABASE_URL into Project ${projectName}.`,
            hint: 'Database/Cache/Storage resources are provisioned by the agent, then wired into Applications through env vars.',
          },
          {
            text: `Connect the existing redis-prod Cache resource to the Application in ${projectName}.`,
          },
        ],
      };
    case 'add-managed-db':
      return {
        heading: 'Tell your agent what to provision',
        lead: 'Database, Cache, and Storage resources are provisioned first, then wired into Applications or Compose stacks as env vars.',
        prompts: [
          {
            text: 'Provision a PostgreSQL Database resource named app-db.',
            hint: 'Then: add the connection string to an Application as `DATABASE_URL` and redeploy it.',
          },
          {
            text: 'Provision a Redis Cache resource named sessions, then wire it into my app as `REDIS_URL`.',
          },
          {
            text: 'List existing Database/Cache/Storage resources and tell me which ones are unwired.',
          },
        ],
      };
    case 'add-domain':
      return {
        heading: 'Tell your agent which domain to attach',
        lead: 'Domain attachment registers an OpenLander route for a host that already points at this server. DNS and TLS stay outside OpenLander in v0.1; your agent can verify route health after registration.',
        prompts: [
          {
            text: `Attach app.example.com to ${serviceName} on Project ${projectName}, then verify the domain route health.`,
          },
          {
            text: `List domain routes for ${serviceName} and tell me which hosts are healthy.`,
          },
        ],
      };
    case 'scale-service':
      return {
        heading: 'Tell your agent how to scale',
        lead: 'Replica counts and resource limits are agent-driven so the change is reviewable and reversible from your chat history.',
        prompts: [
          {
            text: `Scale ${serviceName} in ${projectName} to 3 replicas.`,
          },
          {
            text: `Bump ${serviceName} memory in ${projectName} to 1Gi and tell me when it's stable.`,
          },
        ],
      };
    case 'delete-service':
      return {
        heading: 'Tell your agent to archive this Application',
        lead: 'Permanent Project/Application deletion is human UI-only. Your agent can request reversible archive/restore, then explain what remains before you use the web Danger zone.',
        prompts: [
          {
            text: `Archive ${serviceName} in Project ${projectName} and tell me what will remain restorable.`,
          },
          {
            text: `Check whether ${serviceName} in Project ${projectName} still references any Database/Cache resource before I delete anything in the web UI.`,
            hint: 'Use the web Danger zone for permanent deletion; MCP archive is reversible and approval-gated.',
          },
        ],
      };
    case 'remove-domain': {
      const domain = ctx.domain ?? 'app.example.com';
      return {
        heading: 'Tell your agent which domain to detach',
        lead: 'Domain removal is handled in the web Domains tab in v0.1. Your agent can inspect current route health and confirm which Host/path route you are about to remove.',
        prompts: [
          {
            text: `List domain routes for ${serviceName} and confirm whether ${domain} is currently healthy before I remove it in the web UI.`,
          },
          {
            text: `Diagnose why ${domain} is failing on ${serviceName} before I change the route.`,
            hint: 'OpenLander v0.1 does not create DNS records or TLS certificates; check those outside OpenLander.',
          },
        ],
      };
    }
    case 'set-env-var': {
      const key = ctx.envVarKey ?? 'KEY_NAME';
      return {
        heading: 'Tell your agent which env var to set',
        lead: 'Env var changes are saved through MCP. Ask the agent to apply them with a redeploy, or request immediate runtime apply only when that is intentional.',
        prompts: [
          {
            text: `Set ${key} on ${projectName} to <value> and redeploy.`,
            hint: 'Replace `<value>` before pasting.',
          },
          {
            text: `Set ${key} only on ${serviceName} (not the whole ${projectName} group) and redeploy ${serviceName}.`,
          },
        ],
      };
    }
    case 'delete-env-var': {
      const key = ctx.envVarKey ?? 'KEY_NAME';
      return {
        heading: 'Tell your agent which env var to remove',
        lead: 'Env var removals are saved through MCP. Ask the agent to check impact and redeploy the affected Application/Compose workload when needed.',
        prompts: [
          {
            text: `Remove ${key} from ${projectName} and redeploy.`,
          },
          {
            text: `Remove ${key} from every service in ${projectName} and confirm none of them still reference it.`,
          },
        ],
      };
    }
    case 'wire-managed-db': {
      const managed = ctx.managedServiceName ?? 'cache';
      return {
        heading: 'Tell your agent which project to wire',
        lead: `${managed} is provisioned but not yet wired. Hand the agent a target project and an env var key — it'll set the connection string and queue a redeploy.`,
        prompts: [
          {
            text: `Wire ${managed} into ${projectName} as DATABASE_URL.`,
          },
          {
            text: `Wire ${managed} into ${projectName} as a service-scoped REDIS_URL on ${serviceName}.`,
            hint: 'Use the service-scoped form when only one service should see the variable.',
          },
        ],
      };
    }
  }
}
