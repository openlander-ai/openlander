import { nanoid } from 'nanoid';

import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { disableWebhookSchema, enableWebhookSchema, getWebhookConfigSchema } from './schemas.js';

function getProjectByName(appCtx: Parameters<ToolDef['execute']>[1]['appCtx'], name: string) {
  const project = appCtx.db.getProjectByName(name);
  if (!project) {
    throw new ProjectNotFoundError(name);
  }
  return project;
}

const enableWebhookTool: ToolDef = {
  name: 'enable_webhook',
  description:
    'Enable automatic deploys via webhook for a git provider (GitHub, GitLab, or Bitbucket). When enabled, pushing to the configured branch triggers a redeploy. Returns { id, source, secret, enabled, branchFilter, webhookPath }. The webhookPath is relative - combine with your OpenLander host URL to get the full webhook URL for configuring in your git provider. Errors: PROJECT_NOT_FOUND.',
  inputSchema: enableWebhookSchema,
  execute: (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const source = args['source'] as 'github' | 'gitlab' | 'bitbucket';
    const branchFilter = args['branch_filter'] as string | undefined;
    const project = getProjectByName(appCtx, projectName);
    const id = nanoid(12);
    const secret = appCtx.webhookManager.generateSecret(project.id);

    appCtx.db.setWebhookConfig({
      id,
      projectId: project.id,
      source,
      secret,
      branchFilter,
      enabled: true,
    });

    return {
      id,
      source,
      secret,
      enabled: true,
      branchFilter: branchFilter ?? 'main',
      webhookPath: `/api/webhooks/${project.id}/${source}`,
      action_required: [
        'Configure this webhook URL and secret in your git provider settings (GitHub → Settings → Webhooks → Add webhook).',
      ],
    };
  },
};

const disableWebhookTool: ToolDef = {
  name: 'disable_webhook',
  description:
    'Disable webhook auto-deploy for a specific git provider on a project. Does not delete the configuration - re-enable with enable_webhook. Returns { status, project, source }. Errors: PROJECT_NOT_FOUND, WEBHOOK_NOT_FOUND.',
  inputSchema: disableWebhookSchema,
  execute: (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const source = args['source'] as 'github' | 'gitlab' | 'bitbucket';
    const project = getProjectByName(appCtx, projectName);
    const configs = appCtx.db.getWebhookConfigs(project.id);
    const config = configs.find((item) => item.source === source);

    if (!config) {
      return {
        error: 'WEBHOOK_NOT_FOUND',
        message: `No webhook configured for ${source} on project ${projectName}`,
      };
    }

    appCtx.db.setWebhookEnabled(config.id, false);

    return {
      status: 'disabled',
      project: projectName,
      source,
    };
  },
};

const getWebhookConfigTool: ToolDef = {
  name: 'get_webhook_config',
  description:
    'Get all webhook configurations for a project. Shows enabled status, git provider, branch filter, and webhook URL path for each configured webhook. Returns { count, webhooks[] }. Errors: PROJECT_NOT_FOUND.',
  inputSchema: getWebhookConfigSchema,
  execute: (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const project = getProjectByName(appCtx, projectName);
    const configs = appCtx.db.getWebhookConfigs(project.id);

    return {
      count: configs.length,
      webhooks: configs.map((config) => ({
        id: config.id,
        source: config.source,
        enabled: config.enabled === 1,
        branchFilter: config.branch_filter,
        secret: `${config.secret.slice(0, 8)}...`,
        webhookPath: `/api/webhooks/${project.id}/${config.source}`,
      })),
    };
  },
};

export const webhookToolDefs: ToolDef[] = [
  enableWebhookTool,
  disableWebhookTool,
  getWebhookConfigTool,
];
