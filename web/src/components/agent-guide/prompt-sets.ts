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
        lead: 'Service creation runs through your agent over MCP. Paste a prompt — your agent deploys, wires, and reports back here.',
        prompts: [
          {
            text: `Deploy github.com/myorg/myapp to project ${projectName} as a worker service.`,
          },
          {
            text: `Add a postgres database to project ${projectName} named cache.`,
            hint: 'Managed DBs are global in 1.0. The agent provisions, then wires `DATABASE_URL` for you.',
          },
          {
            text: `Connect the existing redis-prod managed service to project ${projectName}.`,
          },
        ],
      };
    case 'add-managed-db':
      return {
        heading: 'Tell your agent what to provision',
        lead: 'Managed databases are provisioned through MCP, then wired into a project as environment variables. Both steps are one prompt away.',
        prompts: [
          {
            text: 'Provision a managed postgres named cache.',
            hint: 'Then: add the connection string to project hotdeal as `DATABASE_URL`.',
          },
          {
            text: 'Provision a managed redis named sessions, then wire it into project hotdeal as `REDIS_URL`.',
          },
          {
            text: 'List existing managed services and tell me which ones are unwired.',
          },
        ],
      };
    case 'add-domain':
      return {
        heading: 'Tell your agent which domain to attach',
        lead: 'Domain attachment, DNS verification, and TLS issuance all run through MCP. Your agent will surface verification records and confirm when the cert is live.',
        prompts: [
          {
            text: `Attach app.example.com to ${serviceName} on project ${projectName} as the primary domain.`,
          },
          {
            text: `Move the existing domain off ${serviceName} to staging.`,
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
        heading: 'Tell your agent to remove this service',
        lead: 'Service removal goes through your agent so the reasoning — and any preflight check — lives in your chat history. Containers, env vars, and DNS are cleaned up together.',
        prompts: [
          {
            text: `Stop and remove ${serviceName} from ${projectName}. Drop its env vars but keep any managed DB it referenced.`,
          },
          {
            text: `Remove ${serviceName} from ${projectName} and any managed DB it was the only consumer of.`,
            hint: 'Use this only when the managed DB is no longer needed by anything else.',
          },
        ],
      };
    case 'remove-domain': {
      const domain = ctx.domain ?? 'app.example.com';
      return {
        heading: 'Tell your agent which domain to detach',
        lead: 'Domain detachment, DNS deactivation, and cert revocation run through MCP so the agent can confirm propagation and stop traffic cleanly.',
        prompts: [
          {
            text: `Detach ${domain} from ${serviceName} and tell me when DNS has propagated.`,
          },
          {
            text: `Move ${domain} off ${serviceName} and over to staging.`,
            hint: 'Useful when promoting/demoting between environments.',
          },
        ],
      };
    }
    case 'set-env-var': {
      const key = ctx.envVarKey ?? 'KEY_NAME';
      return {
        heading: 'Tell your agent which env var to set',
        lead: 'Env var changes flow through the agent so secrets land in the right scope and the redeploy is queued automatically.',
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
        lead: 'Env var removals go through the agent so the redeploy and any consumer-impact check are part of the same operation.',
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
