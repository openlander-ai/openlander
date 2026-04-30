export type AgentGuideKind = 'add-service' | 'add-managed-db' | 'add-domain' | 'scale-service';

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
  }
}
