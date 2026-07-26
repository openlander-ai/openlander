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

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function getAgentGuideContent(
  kind: AgentGuideKind,
  ctx: AgentGuideContext = {},
  t: Translate,
): AgentGuideContent {
  const projectName = ctx.projectName ?? 'your-project';
  const serviceName = ctx.serviceName ?? 'your-service';

  switch (kind) {
    case 'add-service':
      return {
        heading: t('agentGuide.content.addService.heading'),
        lead: t('agentGuide.content.addService.lead'),
        prompts: [
          {
            text: t('agentGuide.content.addService.prompt.deploy', { projectName }),
          },
          {
            text: t('agentGuide.content.addService.prompt.database', { projectName }),
            hint: t('agentGuide.content.addService.hint.database'),
          },
          {
            text: t('agentGuide.content.addService.prompt.cache', { projectName }),
          },
        ],
      };
    case 'add-managed-db':
      return {
        heading: t('agentGuide.content.addManagedDb.heading'),
        lead: t('agentGuide.content.addManagedDb.lead'),
        prompts: [
          {
            text: t('agentGuide.content.addManagedDb.prompt.postgres'),
            hint: t('agentGuide.content.addManagedDb.hint.postgres'),
          },
          {
            text: t('agentGuide.content.addManagedDb.prompt.redis'),
          },
          {
            text: t('agentGuide.content.addManagedDb.prompt.list'),
          },
        ],
      };
    case 'add-domain':
      return {
        heading: t('agentGuide.content.addDomain.heading'),
        lead: t('agentGuide.content.addDomain.lead'),
        prompts: [
          {
            text: t('agentGuide.content.addDomain.prompt.attach', {
              serviceName,
              projectName,
            }),
          },
          {
            text: t('agentGuide.content.addDomain.prompt.list', { serviceName }),
          },
        ],
      };
    case 'scale-service':
      return {
        heading: t('agentGuide.content.scaleService.heading'),
        lead: t('agentGuide.content.scaleService.lead'),
        prompts: [
          {
            text: t('agentGuide.content.scaleService.prompt.replicas', {
              serviceName,
              projectName,
            }),
          },
          {
            text: t('agentGuide.content.scaleService.prompt.memory', {
              serviceName,
              projectName,
            }),
          },
        ],
      };
    case 'delete-service':
      return {
        heading: t('agentGuide.content.deleteService.heading'),
        lead: t('agentGuide.content.deleteService.lead'),
        prompts: [
          {
            text: t('agentGuide.content.deleteService.prompt.archive', {
              serviceName,
              projectName,
            }),
          },
          {
            text: t('agentGuide.content.deleteService.prompt.checkReferences', {
              serviceName,
              projectName,
            }),
            hint: t('agentGuide.content.deleteService.hint.checkReferences'),
          },
        ],
      };
    case 'remove-domain': {
      const domain = ctx.domain ?? 'app.example.com';
      return {
        heading: t('agentGuide.content.removeDomain.heading'),
        lead: t('agentGuide.content.removeDomain.lead'),
        prompts: [
          {
            text: t('agentGuide.content.removeDomain.prompt.check', { serviceName, domain }),
          },
          {
            text: t('agentGuide.content.removeDomain.prompt.diagnose', { serviceName, domain }),
            hint: t('agentGuide.content.removeDomain.hint.diagnose'),
          },
        ],
      };
    }
    case 'set-env-var': {
      const key = ctx.envVarKey ?? 'KEY_NAME';
      return {
        heading: t('agentGuide.content.setEnvVar.heading'),
        lead: t('agentGuide.content.setEnvVar.lead'),
        prompts: [
          {
            text: t('agentGuide.content.setEnvVar.prompt.project', { key, projectName }),
            hint: t('agentGuide.content.setEnvVar.hint.project'),
          },
          {
            text: t('agentGuide.content.setEnvVar.prompt.service', {
              key,
              serviceName,
              projectName,
            }),
          },
        ],
      };
    }
    case 'delete-env-var': {
      const key = ctx.envVarKey ?? 'KEY_NAME';
      return {
        heading: t('agentGuide.content.deleteEnvVar.heading'),
        lead: t('agentGuide.content.deleteEnvVar.lead'),
        prompts: [
          {
            text: t('agentGuide.content.deleteEnvVar.prompt.project', { key, projectName }),
          },
          {
            text: t('agentGuide.content.deleteEnvVar.prompt.allServices', { key, projectName }),
          },
        ],
      };
    }
    case 'wire-managed-db': {
      const managed = ctx.managedServiceName ?? 'cache';
      return {
        heading: t('agentGuide.content.wireManagedDb.heading'),
        lead: t('agentGuide.content.wireManagedDb.lead', { managed }),
        prompts: [
          {
            text: t('agentGuide.content.wireManagedDb.prompt.project', { managed, projectName }),
          },
          {
            text: t('agentGuide.content.wireManagedDb.prompt.service', {
              managed,
              projectName,
              serviceName,
            }),
            hint: t('agentGuide.content.wireManagedDb.hint.service'),
          },
        ],
      };
    }
  }
}
