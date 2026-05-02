import { nanoid } from 'nanoid';

import type { ToolDef } from './types.js';
import { getProjectByName } from './helpers.js';
import { disableWebhookSchema, enableWebhookSchema, getWebhookConfigSchema } from './schemas.js';

const enableWebhookTool: ToolDef = {
  name: 'enable_webhook',
  riskLevel: 'medium',
  description:
    'Enable automatic deploys via webhook for a git provider (GitHub, GitLab, or Bitbucket). When enabled, pushing to the configured branch triggers a redeploy. Returns { id, source, secret, enabled, branchFilter, webhookPath, reused }. The webhookPath is relative - combine with your OpenLander host URL to get the full webhook URL for configuring in your git provider. Errors: PROJECT_NOT_FOUND.',
  mcpDescription: 'Configure an auto-deploy webhook for GitHub, GitLab, or Bitbucket.',
  inputSchema: enableWebhookSchema,
  execute: async (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const source = args['source'] as 'github' | 'gitlab' | 'bitbucket';
    const branchFilter = args['branch_filter'] as string | undefined;
    const project = await getProjectByName(appCtx, projectName);

    // Check if webhook config already exists for this project and source
    const existingConfigs = await appCtx.db.getWebhookConfigs(project.id);
    const existingConfig = existingConfigs.find((config) => config.source === source);

    let id: string;
    let secret: string;
    let reused = false;

    if (existingConfig && existingConfig.enabled === 0) {
      // Reuse existing disabled webhook
      id = existingConfig.id;
      secret = existingConfig.secret;
      reused = true;
      await appCtx.db.setWebhookEnabled(id, true);
    } else {
      // Generate new webhook credentials
      id = nanoid(12);
      secret = appCtx.webhookManager.generateSecret(project.id);
      await appCtx.db.setWebhookConfig({
        id,
        projectId: project.id,
        source,
        secret,
        branchFilter,
        enabled: true,
      });
    }

    return {
      id,
      source,
      secret,
      enabled: true,
      branchFilter: branchFilter ?? 'main',
      webhookPath: `/api/webhooks/${project.id}/${source}`,
      reused,
      _agent_guidance: {
        next_steps: reused
          ? [
              'Your existing GitHub webhook settings are still valid - no need to reconfigure in git provider',
              'Call get_webhook_config to verify webhook setup is correct.',
            ]
          : [
              'Configure this webhook URL and secret in git provider settings (GitHub → Settings → Webhooks)',
              'Call get_webhook_config to verify webhook setup is correct.',
            ],
      },
    };
  },
};

const disableWebhookTool: ToolDef = {
  name: 'disable_webhook',
  riskLevel: 'medium',
  description:
    'Disable webhook auto-deploy for a specific git provider on a project. Does not delete the configuration - re-enable with enable_webhook. Returns { status, project, source }. Errors: PROJECT_NOT_FOUND, WEBHOOK_NOT_FOUND.',
  mcpDescription: 'Disable auto-deploy webhook while keeping its configuration.',
  inputSchema: disableWebhookSchema,
  execute: async (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const source = args['source'] as 'github' | 'gitlab' | 'bitbucket';
    const project = await getProjectByName(appCtx, projectName);
    const configs = await appCtx.db.getWebhookConfigs(project.id);
    const config = configs.find((item) => item.source === source);

    if (!config) {
      throw new Error(
        `WEBHOOK_NOT_FOUND: No webhook configured for ${source} on project ${projectName}`,
      );
    }

    await appCtx.db.setWebhookEnabled(config.id, false);

    return {
      status: 'disabled',
      project: projectName,
      source,
    };
  },
};

const getWebhookConfigTool: ToolDef = {
  name: 'get_webhook_config',
  riskLevel: 'low',
  description:
    'Get all webhook configurations for a project. Shows enabled status, git provider, branch filter, webhook URL path, and partially masked secret (first 8 characters) for each configured webhook. Returns { count, webhooks[] }. Errors: PROJECT_NOT_FOUND.',
  mcpDescription: 'Get webhook configuration and enabled status for a project.',
  inputSchema: getWebhookConfigSchema,
  execute: async (args, { appCtx }) => {
    const projectName = args['project_name'] as string;
    const project = await getProjectByName(appCtx, projectName);
    const configs = await appCtx.db.getWebhookConfigs(project.id);

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
