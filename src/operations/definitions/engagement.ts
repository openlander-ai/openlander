import { z } from 'zod';

import { ApplicationOperationContractError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const bootstrapEngagementInput = z
  .object({
    customer_name: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(20_000).optional(),
    project: z
      .object({
        name: z.string().trim().min(1).max(100).regex(PROJECT_NAME_RE),
        display_name: z.string().trim().min(1).max(300).optional(),
        description: z.string().trim().max(20_000).optional(),
        tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
      })
      .strict(),
  })
  .strict();

const bootstrapEngagementOutput = z
  .object({
    status: z.literal('created'),
    engagement_id: z.string().min(1),
    project_id: z.string().min(1),
    project_name: z.string().min(1),
    engagement_status: z.enum(['active', 'on_hold', 'completed', 'archived']),
    runtime_health: z.enum(['healthy', 'degraded', 'unknown']),
    project_count: z.number().int().nonnegative(),
    delivery_count: z.number().int().nonnegative(),
    blocker_count: z.number().int().nonnegative(),
    suggested_call: z.object({
      operation: z.literal('plan_delivery'),
      input: z.object({ project_id: z.string().min(1) }),
    }),
    _agent_guidance: z.object({
      message: z.string(),
      next_steps: z.array(z.string()).max(3),
    }),
  })
  .strict();

export const bootstrapEngagementOperation: ApplicationOperationDefinition = {
  name: 'bootstrap_engagement',
  version: 1,
  description: 'Create one Engagement and its initial empty Project atomically.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: bootstrapEngagementInput,
  outputSchema: bootstrapEngagementOutput,
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    if (!context.operationId) {
      throw new ApplicationOperationContractError('bootstrap_engagement', {
        reason: 'persisted_operation_id_required',
      });
    }
    const project = input['project'] as z.infer<typeof bootstrapEngagementInput>['project'];
    const created = await context.appCtx.engagementService.bootstrap({
      operationId: context.operationId,
      customerName: String(input['customer_name']),
      title: String(input['title']),
      summary: typeof input['summary'] === 'string' ? input['summary'] : undefined,
      project: {
        name: project.name,
        displayName: project.display_name,
        description: project.description,
        tags: project.tags,
      },
      actor: context.actor.label,
    });
    return {
      status: 'created',
      engagement_id: created.engagement.id,
      project_id: created.project_id,
      project_name: created.project_name,
      engagement_status: created.engagement.status,
      runtime_health: created.engagement.runtime_health,
      project_count: created.engagement.project_count,
      delivery_count: created.engagement.delivery_summary.total,
      blocker_count: created.engagement.blocker_count,
      suggested_call: {
        operation: 'plan_delivery',
        input: { project_id: created.project_id },
      },
      _agent_guidance: {
        message:
          'Engagement and initial Project are ready. Plan the first Delivery from the brief and repository manifest.',
        next_steps: [
          'Call plan_delivery with the returned project_id.',
          'Commit .openlander/project.yml and .openlander/delivery.yml before starting a run.',
        ],
      },
    };
  },
};

export const updateEngagementFromBriefOperation: ApplicationOperationDefinition = {
  name: 'update_engagement_from_brief',
  version: 1,
  description:
    'Apply an agent-structured customer brief to Engagement metadata while preserving evidence history.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z
    .object({
      engagement_id: z.string().min(1),
      customer_name: z.string().trim().min(1).max(300).optional(),
      title: z.string().trim().min(1).max(300).optional(),
      summary: z.string().trim().max(20_000).optional(),
      status: z.enum(['active', 'on_hold', 'completed']).optional(),
      source_artifact_ids: z.array(z.string().min(1)).max(20).default([]),
    })
    .strict()
    .refine(
      (input) =>
        input.customer_name !== undefined ||
        input.title !== undefined ||
        input.summary !== undefined ||
        input.status !== undefined,
      { message: 'At least one Engagement field must be supplied.' },
    ),
  outputSchema: z
    .object({
      status: z.literal('updated'),
      engagement_id: z.string(),
      engagement_status: z.enum(['active', 'on_hold', 'completed', 'archived']),
      project_count: z.number().int().nonnegative(),
      delivery_count: z.number().int().nonnegative(),
      blocker_count: z.number().int().nonnegative(),
      source_artifact_count: z.number().int().nonnegative(),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const engagementId = String(input['engagement_id']);
    const sourceArtifactIds = input['source_artifact_ids'] as string[];
    if (sourceArtifactIds.length > 0) {
      const [artifactRows, current] = await Promise.all([
        context.appCtx.db.getArtifactProjectRowsByIds(sourceArtifactIds),
        context.appCtx.engagementService.get(engagementId),
      ]);
      const found = new Set(artifactRows.map((artifact) => artifact.artifact_id));
      const missing = sourceArtifactIds.find((artifactId) => !found.has(artifactId));
      if (missing) {
        throw new ApplicationOperationContractError('update_engagement_from_brief', {
          reason: 'source_artifact_not_found',
          artifactId: missing,
        });
      }
      const engagementProjectIds = new Set(current.projects.map((project) => project.id));
      const outside = artifactRows.find(
        (artifact) => !engagementProjectIds.has(artifact.project_id),
      );
      if (outside) {
        throw new ApplicationOperationContractError('update_engagement_from_brief', {
          reason: 'source_artifact_outside_engagement',
          artifactId: outside.artifact_id,
        });
      }
    }
    const engagement = await context.appCtx.engagementService.update(engagementId, {
      ...(typeof input['customer_name'] === 'string'
        ? { customerName: input['customer_name'] }
        : {}),
      ...(typeof input['title'] === 'string' ? { title: input['title'] } : {}),
      ...(typeof input['summary'] === 'string' ? { summary: input['summary'] } : {}),
      ...(typeof input['status'] === 'string'
        ? { status: input['status'] as 'active' | 'on_hold' | 'completed' }
        : {}),
      actor: context.actor.label,
    });
    return {
      status: 'updated',
      engagement_id: engagement.id,
      engagement_status: engagement.status,
      project_count: engagement.project_count,
      delivery_count: engagement.delivery_summary.total,
      blocker_count: engagement.blocker_count,
      source_artifact_count: sourceArtifactIds.length,
      _agent_guidance: {
        message:
          'The structured brief was applied. Existing Delivery evidence and finalized Receipt snapshots were not changed.',
        next_steps: [
          'Record project-specific decisions with record_project_update.',
          'Inspect the Engagement blockers before planning more work.',
        ],
      },
    };
  },
};

const engagementMutationSummarySchema = z.object({
  engagement_id: z.string().min(1),
  engagement_status: z.enum(['active', 'on_hold', 'completed', 'archived']),
  project_count: z.number().int().nonnegative(),
  delivery_count: z.number().int().nonnegative(),
  blocker_count: z.number().int().nonnegative(),
});

function engagementMutationSummary(engagement: {
  id: string;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
  project_count: number;
  delivery_summary: { total: number };
  blocker_count: number;
}) {
  return {
    engagement_id: engagement.id,
    engagement_status: engagement.status,
    project_count: engagement.project_count,
    delivery_count: engagement.delivery_summary.total,
    blocker_count: engagement.blocker_count,
  };
}

export const linkProjectToEngagementOperation: ApplicationOperationDefinition = {
  name: 'link_project_to_engagement',
  version: 1,
  description: 'Link one existing Project to an active Engagement.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({ engagement_id: z.string().min(1), project_id: z.string().min(1) })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('linked'),
      ...engagementMutationSummarySchema.shape,
      suggested_call: z.object({
        operation: z.literal('get_engagement'),
        input: z.object({ engagement_id: z.string().min(1) }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    const engagementId = String(input['engagement_id']);
    const engagement = await context.appCtx.engagementService.linkProject(
      engagementId,
      String(input['project_id']),
      context.actor.label,
    );
    return {
      status: 'linked',
      ...engagementMutationSummary(engagement),
      suggested_call: { operation: 'get_engagement', input: { engagement_id: engagementId } },
      _agent_guidance: {
        message:
          'The Project is linked. Its runtime and Delivery state are now included in the Engagement rollup.',
        next_steps: ['Inspect the updated Engagement summary before planning cross-Project work.'],
      },
    };
  },
};

export const unlinkProjectFromEngagementOperation: ApplicationOperationDefinition = {
  name: 'unlink_project_from_engagement',
  version: 1,
  description:
    'Remove one Project from an active Engagement without changing the Project or its evidence.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({ engagement_id: z.string().min(1), project_id: z.string().min(1) })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('unlinked'),
      project_id: z.string().min(1),
      ...engagementMutationSummarySchema.shape,
      suggested_call: z.object({
        operation: z.literal('get_engagement'),
        input: z.object({ engagement_id: z.string().min(1) }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    const engagementId = String(input['engagement_id']);
    const projectId = String(input['project_id']);
    const engagement = await context.appCtx.engagementService.unlinkProject(
      engagementId,
      projectId,
      context.actor.label,
    );
    return {
      status: 'unlinked',
      project_id: projectId,
      ...engagementMutationSummary(engagement),
      suggested_call: { operation: 'get_engagement', input: { engagement_id: engagementId } },
      _agent_guidance: {
        message:
          'The Project was unlinked. Its runtime, Delivery evidence, and finalized Receipts were not changed.',
        next_steps: ['Inspect the updated Engagement summary.'],
      },
    };
  },
};

export const archiveEngagementOperation: ApplicationOperationDefinition = {
  name: 'archive_engagement',
  version: 1,
  description: 'Archive an Engagement while preserving its Project links and all runtime state.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z.object({ engagement_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('archived'),
      ...engagementMutationSummarySchema.shape,
      suggested_call: z.object({
        operation: z.literal('get_engagement'),
        input: z.object({ engagement_id: z.string().min(1) }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    const engagementId = String(input['engagement_id']);
    const engagement = await context.appCtx.engagementService.archive(
      engagementId,
      context.actor.label,
    );
    return {
      status: 'archived',
      ...engagementMutationSummary(engagement),
      suggested_call: { operation: 'get_engagement', input: { engagement_id: engagementId } },
      _agent_guidance: {
        message:
          'The Engagement was archived. Linked Projects, Deliveries, and runtime state were not changed.',
        next_steps: ['Use unarchive_engagement before changing metadata or Project links.'],
      },
    };
  },
};

export const unarchiveEngagementOperation: ApplicationOperationDefinition = {
  name: 'unarchive_engagement',
  version: 1,
  description: 'Restore an archived Engagement to active status.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z.object({ engagement_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('unarchived'),
      ...engagementMutationSummarySchema.shape,
      suggested_call: z.object({
        operation: z.literal('get_engagement'),
        input: z.object({ engagement_id: z.string().min(1) }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    const engagementId = String(input['engagement_id']);
    const engagement = await context.appCtx.engagementService.unarchive(
      engagementId,
      context.actor.label,
    );
    return {
      status: 'unarchived',
      ...engagementMutationSummary(engagement),
      suggested_call: { operation: 'get_engagement', input: { engagement_id: engagementId } },
      _agent_guidance: {
        message: 'The Engagement is active again and can accept metadata or Project-link changes.',
        next_steps: ['Inspect the Engagement summary before making further changes.'],
      },
    };
  },
};

export const engagementOperations = [
  bootstrapEngagementOperation,
  updateEngagementFromBriefOperation,
  linkProjectToEngagementOperation,
  unlinkProjectFromEngagementOperation,
  archiveEngagementOperation,
  unarchiveEngagementOperation,
] as const;
