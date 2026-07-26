import { z } from 'zod';

import type { ApplicationOperationDefinition } from '../types.js';

export const applyProjectManifestOperation: ApplicationOperationDefinition = {
  name: 'apply_project_manifest',
  version: 1,
  description:
    'Apply versioned Project Environment and Promotion order from .openlander/project.yml.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      manifest_path: z.string().trim().min(1).max(500).default('.openlander/project.yml'),
      manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      environments: z
        .array(
          z
            .object({
              key: z
                .string()
                .trim()
                .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
              display_name: z.string().trim().min(1).max(200),
              tier: z.enum(['development', 'validation', 'production']),
              promotion_order: z.number().int().min(0).max(1_000),
              health_timeout_seconds: z.number().int().min(1).max(600).default(30),
              smoke_path: z.string().trim().startsWith('/').max(500).nullable().default(null),
              soak_seconds: z.number().int().min(0).max(3_600).default(0),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('applied'),
      project_id: z.string(),
      manifest_sha256: z.string(),
      environments: z.array(
        z.object({
          environment_id: z.string(),
          key: z.string(),
          tier: z.string(),
          promotion_order: z.number(),
          health_timeout_seconds: z.number().int().positive(),
          smoke_path: z.string().nullable(),
          soak_seconds: z.number().int().nonnegative(),
        }),
      ),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const rawEnvironments = input['environments'] as Array<{
      key: string;
      display_name: string;
      tier: 'development' | 'validation' | 'production';
      promotion_order: number;
      health_timeout_seconds: number;
      smoke_path: string | null;
      soak_seconds: number;
    }>;
    const environments = await context.appCtx.projectManifestService.apply({
      projectId: String(input['project_id']),
      manifestPath: String(input['manifest_path']),
      manifestSha256: String(input['manifest_sha256']),
      environments: rawEnvironments.map((environment) => ({
        key: environment.key,
        displayName: environment.display_name,
        tier: environment.tier,
        promotionOrder: environment.promotion_order,
        healthTimeoutSeconds: environment.health_timeout_seconds,
        smokePath: environment.smoke_path,
        soakSeconds: environment.soak_seconds,
      })),
      actor: context.actor.label,
    });
    return {
      status: 'applied',
      project_id: String(input['project_id']),
      manifest_sha256: String(input['manifest_sha256']),
      environments: environments.map((environment) => ({
        environment_id: environment.id,
        key: environment.key,
        tier: environment.tier,
        promotion_order: environment.promotion_order,
        health_timeout_seconds: environment.health_timeout_seconds,
        smoke_path: environment.smoke_path,
        soak_seconds: environment.soak_seconds,
      })),
      _agent_guidance: {
        message: 'Project Environment order is applied from the manifest snapshot.',
        next_steps: [
          'Plan and run the Delivery.',
          'Promote one immutable Release through this order.',
        ],
      },
    };
  },
};
