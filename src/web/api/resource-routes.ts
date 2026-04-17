import { Hono } from 'hono';
import { z } from 'zod';

import type { AppContext } from '../../app.js';

// ─── Validation Schemas ────────────────────────────────────────────────────

const VALID_PROFILES = ['micro', 'small', 'medium', 'large', 'custom'] as const;

export const UpdateResourceLimitsSchema = z
  .object({
    profile: z.enum(VALID_PROFILES),
    memoryMb: z.number().min(64).optional(),
  })
  .refine(
    (data) => data.profile !== 'custom' || (data.memoryMb !== undefined && data.memoryMb > 0),
    { message: 'memoryMb is required when profile is "custom"', path: ['memoryMb'] },
  );

export type UpdateResourceLimitsInput = z.infer<typeof UpdateResourceLimitsSchema>;

export const ResourceLimitsResponseSchema = z.object({
  profile: z.enum(VALID_PROFILES).nullable(),
  memory: z
    .object({
      limitBytes: z.number(),
      reservationBytes: z.number(),
      swapBytes: z.number(),
    })
    .nullable(),
  cpu: z.object({ shares: z.number() }).nullable(),
  warnings: z.array(z.string()).optional(),
});

export type ResourceLimitsResponse = z.infer<typeof ResourceLimitsResponseSchema>;

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createResourceRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  // GET /api/projects/:id/resources
  api.get('/projects/:id/resources', (c) => {
    // TODO Task 10: implement GET logic
    return c.json({ error: 'Not implemented' }, 501);
  });

  // PATCH /api/projects/:id/resources
  api.patch('/projects/:id/resources', (c) => {
    // TODO Task 10: implement PATCH logic
    return c.json({ error: 'Not implemented' }, 501);
  });

  return api;
}
