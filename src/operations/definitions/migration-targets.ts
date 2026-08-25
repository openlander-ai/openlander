import { z } from 'zod';

import type { ApplicationOperationDefinition } from '../types.js';

const targetResourceMappingSchema = z
  .object({
    source_service_id: z.string(),
    source_service_name: z.string(),
    source_kind: z.enum([
      'git',
      'image',
      'compose',
      'compose-child',
      'postgres',
      'mysql',
      'redis',
      'mongo',
      'neo4j',
      'minio',
    ]),
    source_ownership: z.enum(['project', 'connected']),
    target_resource_type: z.string(),
    target_resource_name: z.string(),
    category: z.enum(['compute', 'database', 'cache', 'storage', 'configuration', 'networking']),
    migration_method: z.enum([
      'rebuild_from_source',
      'redeploy_image',
      'manual_decomposition',
      'logical_export_import',
      'object_copy',
      'file_sync',
      'manual_replatform',
    ]),
    confidence: z.enum(['high', 'medium', 'low']),
    required_actions: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();

const targetPlanSchema = z
  .object({
    id: z.enum(['aws_ecs_fargate', 'gcp_cloud_run']),
    provider: z.enum(['aws', 'gcp']),
    display_name: z.string(),
    status: z.enum(['compatible', 'review_required', 'blocked']),
    summary: z
      .object({
        mapped_service_count: z.number().int().nonnegative(),
        mapped_volume_count: z.number().int().nonnegative(),
        manual_review_count: z.number().int().nonnegative(),
        blocker_count: z.number().int().nonnegative(),
      })
      .strict(),
    resource_mappings: z.array(targetResourceMappingSchema),
    volume_mappings: z.array(
      z
        .object({
          source_volume_id: z.string(),
          source_volume_name: z.string(),
          source_type: z.enum(['volume', 'bind']),
          target_resource_type: z.string(),
          target_resource_name: z.string(),
          migration_method: z.enum(['logical_export_import', 'file_sync', 'manual_replatform']),
          confidence: z.enum(['high', 'medium', 'low']),
          service_ids: z.array(z.string()),
          required_actions: z.array(z.string()),
        })
        .strict(),
    ),
    supporting_resources: z.array(
      z
        .object({
          resource_type: z.string(),
          display_name: z.string(),
          category: z.enum([
            'compute',
            'database',
            'cache',
            'storage',
            'configuration',
            'networking',
          ]),
          reason: z.string(),
          required: z.boolean(),
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          code: z.string(),
          level: z.enum(['warning', 'blocker']),
          message: z.string(),
          service_id: z.string().nullable(),
        })
        .strict(),
    ),
    references: z.array(z.object({ title: z.string(), url: z.string().url() }).strict()),
  })
  .strict();

export const projectMigrationTargetComparisonSchema = z
  .object({
    schema_version: z.literal('openlander.project-migration-targets/v1'),
    generated_at: z.string(),
    project: z.object({ id: z.string(), name: z.string(), display_name: z.string() }).strict(),
    source_readiness: z.enum(['ready', 'needs_attention', 'blocked']),
    targets: z.array(targetPlanSchema).length(2),
    assessment_policy: z
      .object({
        cloud_changes_made: z.literal(false),
        pricing_queried: z.literal(false),
        account_quotas_queried: z.literal(false),
        data_copied: z.literal(false),
        dns_changed: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const compareMigrationTargetsOperation: ApplicationOperationDefinition = {
  name: 'compare_migration_targets',
  version: 1,
  description:
    'Compare provider-neutral Project migration metadata against AWS ECS/Fargate and Google Cloud Run without querying or changing cloud accounts.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z.object({ project_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('generated'),
      project_id: z.string(),
      comparison: projectMigrationTargetComparisonSchema,
      _agent_guidance: z
        .object({ message: z.string(), next_steps: z.array(z.string()).max(3) })
        .strict(),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const comparison =
      await context.appCtx.projectMigrationService.createTargetComparison(projectId);
    const blockedTargets = comparison.targets.filter(
      (target) => target.status === 'blocked',
    ).length;
    return {
      status: 'generated',
      project_id: projectId,
      comparison,
      _agent_guidance: {
        message: `Compared AWS ECS/Fargate and Google Cloud Run with ${String(blockedTargets)} blocked target(s). No cloud account, runtime, data, or DNS changes were made.`,
        next_steps: [
          'Resolve provider-neutral blockers and low-confidence mappings.',
          'Validate region, IAM, quota, networking, compatibility, and pricing in the chosen cloud account.',
          'Approve one reviewed target before creating any cloud resources.',
        ],
      },
    };
  },
};
