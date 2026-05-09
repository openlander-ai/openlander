import type { Context } from 'hono';

import { FeatureDisabledError } from '../../errors.js';
import { INTERNAL_AI_OPS_DISABLED_MESSAGE } from '../../feature-flags.js';

export function aiOpsDisabledResponse(c: Context): Promise<Response> {
  const error = new FeatureDisabledError(INTERNAL_AI_OPS_DISABLED_MESSAGE);
  return Promise.resolve(c.json(error.toJSON(), error.statusCode as 410));
}
