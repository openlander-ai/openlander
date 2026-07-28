import { z } from 'zod';

import { InvalidSourceFieldsError } from '../../errors.js';
import { assertSafeRepoUrl } from '../../pipeline/git.js';
import type { ApplicationOperationDefinition } from '../types.js';

const projectManifestDriftSchema = z.object({
  scope: z.enum(['environment', 'service']),
  kind: z.enum(['missing', 'retained', 'changed']),
  key: z.string(),
  fields: z.array(z.string()),
});

const projectManifestComparisonSchema = z.object({
  status: z.enum(['not_applied', 'in_sync', 'drifted']),
  state: z.record(z.string(), z.unknown()).nullable(),
  drift: z.array(projectManifestDriftSchema),
});

export const registerProjectRepositoryOperation: ApplicationOperationDefinition = {
  name: 'register_project_repository',
  version: 1,
  description: 'Register one Git repository as a Project source without building or deploying it.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      repo_url: z.string().trim().min(1).max(2_000),
      branch: z.string().trim().min(1).max(255).default('main'),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('registered'),
      project_id: z.string(),
      service_id: z.string(),
      repo_url: z.string(),
      branch: z.string(),
      suggested_call: z.object({
        operation: z.literal('plan_delivery'),
        input: z.object({ project_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const repoUrl = String(input['repo_url']);
    const branch = String(input['branch']);
    assertSafeRepoUrl(repoUrl);
    await context.appCtx.deliveryService.assertProjectCanMutate(projectId);

    const deployables = await context.appCtx.db.getDeployablesByGroup(projectId);
    let service = deployables[0];
    if (deployables.length > 1) {
      throw new InvalidSourceFieldsError(
        'Repository registration requires a Project with no Application or one matching Git Application.',
      );
    }
    if (service) {
      if (service.source !== 'git' || service.repo_url !== repoUrl || service.branch !== branch) {
        throw new InvalidSourceFieldsError(
          'Project already has a different Application source. Use update_application_source for an existing Application.',
        );
      }
    } else {
      service = await context.appCtx.db.ensureDeployableServiceForProject(projectId, {
        source: 'git',
        repoUrl,
        branch,
      });
      if (service.source !== 'git' || service.repo_url !== repoUrl || service.branch !== branch) {
        throw new InvalidSourceFieldsError(
          'Project source changed while the repository was being registered. Read the current Application before retrying.',
        );
      }
      await context.appCtx.db.insertActivityLog({
        event_type: 'project.repository_registered',
        activity_type: 'delivery',
        severity: 'info',
        project_id: projectId,
        correlation_id: projectId,
        title: 'Project repository registered',
        description: 'Git source registered without starting a build or deployment.',
        status: 'completed',
        metadata: JSON.stringify({ repo_url: repoUrl, branch, actor: context.actor.label }),
      });
    }

    return {
      status: 'registered',
      project_id: projectId,
      service_id: service.id,
      repo_url: repoUrl,
      branch,
      suggested_call: { operation: 'plan_delivery', input: { project_id: projectId } },
      _agent_guidance: {
        message: 'The repository is registered without building or deploying an Application.',
        next_steps: [
          'Commit .openlander/delivery.yml in this repository.',
          'Plan or start an Agent Delivery Run pinned to an exact commit.',
        ],
      },
    };
  },
};

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
      services: z
        .array(
          z
            .object({
              service_id: z.string().min(1),
              key: z
                .string()
                .trim()
                .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
              runtime_role: z.enum(['application', 'job', 'resource']),
            })
            .strict(),
        )
        .max(100)
        .optional(),
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
      weekly_report: z
        .object({
          day_of_week: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
          time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          timezone: z.string().trim().min(1).max(100),
          audiences: z
            .array(z.enum(['internal', 'customer']))
            .min(1)
            .max(2)
            .refine((audiences) => new Set(audiences).size === audiences.length, {
              message: 'Weekly report audiences must be unique.',
            }),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('applied'),
      project_id: z.string(),
      manifest_path: z.string(),
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
      comparison: projectManifestComparisonSchema,
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
    const rawServices = input['services'] as
      | Array<{
          service_id: string;
          key: string;
          runtime_role: 'application' | 'job' | 'resource';
        }>
      | undefined;
    const rawWeeklyReport = input['weekly_report'] as
      | {
          day_of_week: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
          time: string;
          timezone: string;
          audiences: Array<'internal' | 'customer'>;
        }
      | null
      | undefined;
    const applied = await context.appCtx.projectManifestService.apply({
      projectId: String(input['project_id']),
      manifestPath: String(input['manifest_path']),
      manifestSha256: String(input['manifest_sha256']),
      services: rawServices?.map((service) => ({
        serviceId: service.service_id,
        key: service.key,
        runtimeRole: service.runtime_role,
      })),
      environments: rawEnvironments.map((environment) => ({
        key: environment.key,
        displayName: environment.display_name,
        tier: environment.tier,
        promotionOrder: environment.promotion_order,
        healthTimeoutSeconds: environment.health_timeout_seconds,
        smokePath: environment.smoke_path,
        soakSeconds: environment.soak_seconds,
      })),
      weeklyReport: rawWeeklyReport
        ? {
            dayOfWeek: rawWeeklyReport.day_of_week,
            time: rawWeeklyReport.time,
            timezone: rawWeeklyReport.timezone,
            audiences: rawWeeklyReport.audiences,
          }
        : null,
      actor: context.actor.label,
    });
    return {
      status: 'applied',
      project_id: String(input['project_id']),
      manifest_path: String(input['manifest_path']),
      manifest_sha256: String(input['manifest_sha256']),
      environments: applied.environments.map((environment) => ({
        environment_id: environment.id,
        key: environment.key,
        tier: environment.tier,
        promotion_order: environment.promotion_order,
        health_timeout_seconds: environment.health_timeout_seconds,
        smoke_path: environment.smoke_path,
        soak_seconds: environment.soak_seconds,
      })),
      comparison: applied.comparison,
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

export const getProjectManifestOperation: ApplicationOperationDefinition = {
  name: 'get_project_manifest',
  version: 1,
  description: 'Read the applied Project manifest snapshot and current DB drift.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z.object({ project_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      project_id: z.string(),
      comparison: projectManifestComparisonSchema,
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => ({
    status: 'ok',
    project_id: String(input['project_id']),
    comparison: await context.appCtx.projectManifestService.getComparison(
      String(input['project_id']),
    ),
  }),
};
