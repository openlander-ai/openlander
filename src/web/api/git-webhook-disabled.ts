import type { Context } from 'hono';

import { FeatureDisabledError } from '../../errors.js';

export const GIT_WEBHOOKS_DISABLED_MESSAGE =
  'Git provider auto-deploy webhooks are disabled in OpenLander 0.1. Use MCP or the UI to deploy explicitly.';

export function gitWebhooksDisabledResponse(c: Context): Response {
  const error = new FeatureDisabledError(GIT_WEBHOOKS_DISABLED_MESSAGE);
  return c.json(error.toJSON(), 410);
}
