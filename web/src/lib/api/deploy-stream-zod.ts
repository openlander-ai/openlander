/**
 * Zod schemas for deploy log SSE event shapes — contract test use only.
 *
 * These match the wire format of /api/deployments/:id/log/stream events
 * as documented in use-deploy-log-stream.ts.
 *
 * Parallel file; keeps zod out of production bundle.
 */
import { z } from 'zod';
import { ErrorClassSchema } from './services-zod';

export const DeployLineEventSchema = z.object({
  type: z.undefined().optional(),
  phase: z.string(),
  prefix: z.string(),
  payload: z.string(),
});

export const DeployEndEventSchema = z.object({
  type: z.literal('end'),
  outcome: z.enum(['success', 'fail', 'cancelled']),
  errorClass: ErrorClassSchema.optional(),
});

export type DeployLineEvent = z.infer<typeof DeployLineEventSchema>;
export type DeployEndEvent = z.infer<typeof DeployEndEventSchema>;
