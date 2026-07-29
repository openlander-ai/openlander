import path from 'node:path';

import { z } from 'zod';

import {
  ApplicationOperationContractError,
  ArtifactNotFoundError,
  ProjectNotFoundError,
  ProjectUpdateProjectMismatchError,
  ProjectUpdateSourceInvalidError,
} from '../../errors.js';
import {
  defaultProjectUpdateStatus,
  type ProjectUpdateKind,
  type ProjectUpdateSource,
} from '../../project-updates/types.js';
import type { ApplicationOperationDefinition } from '../types.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:\//;
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CONTEXT_SOURCE_LABEL_LIMIT = 5;
const CONTEXT_DELIVERY_LINK_LIMIT = 20;
const projectUpdateKind = z.enum([
  'decision',
  'action',
  'risk',
  'question',
  'dependency',
  'progress',
  'fact',
]);
const projectUpdateStatus = z.enum([
  'open',
  'accepted',
  'noted',
  'resolved',
  'dismissed',
  'superseded',
]);

function isRelativeProjectPath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return (
    normalized.length > 0 &&
    !path.posix.isAbsolute(normalized) &&
    !WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized) &&
    !URI_SCHEME_PATTERN.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const updateSource = z
  .object({
    source_type: z.enum(['repository', 'url', 'meeting', 'wbs', 'other']),
    label: z.string().trim().min(1).max(300),
    locator: z.string().trim().min(1).max(2_000).optional(),
    revision: z.string().trim().min(1).max(300).optional(),
    sha256: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

function assertValidSource(source: z.infer<typeof updateSource>, index: number): void {
  if (source.sha256 !== undefined && !SHA256_PATTERN.test(source.sha256)) {
    throw new ProjectUpdateSourceInvalidError(
      'Source sha256 must be a lowercase 64-character hexadecimal digest.',
      { index, sourceType: source.source_type },
    );
  }
  if (
    (source.source_type === 'repository' || source.source_type === 'wbs') &&
    (source.locator === undefined || !isRelativeProjectPath(source.locator))
  ) {
    throw new ProjectUpdateSourceInvalidError(
      'Repository and WBS sources require a relative path without parent traversal.',
      { index, sourceType: source.source_type },
    );
  }
  if (
    source.source_type === 'url' &&
    (source.locator === undefined || !isHttpUrl(source.locator))
  ) {
    throw new ProjectUpdateSourceInvalidError('URL sources require an HTTP or HTTPS locator.', {
      index,
      sourceType: source.source_type,
    });
  }
  if (source.source_type === 'url' && source.locator !== undefined) {
    const parsed = new URL(source.locator);
    if (parsed.username || parsed.password) {
      throw new ProjectUpdateSourceInvalidError(
        'URL sources must not include embedded credentials.',
        { index, sourceType: source.source_type },
      );
    }
  }
}

const updateEntry = z
  .object({
    kind: projectUpdateKind,
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(20_000),
    status: projectUpdateStatus.optional(),
  })
  .strict();

const updateTransition = z
  .object({
    item_id: z.string().min(1),
    expected_status: projectUpdateStatus,
    status: z.enum(['resolved', 'dismissed', 'superseded']),
    note: z.string().trim().min(1).max(4_000),
  })
  .strict();

const recordProjectUpdateInput = z
  .object({
    project_id: z.string().min(1),
    delivery_id: z.string().min(1).optional(),
    summary: z.string().trim().min(1).max(20_000),
    occurred_at: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'occurred_at must be an ISO timestamp')
      .optional(),
    sources: z.array(updateSource).max(20).optional(),
    source_artifact_ids: z.array(z.string().min(1)).max(20).optional(),
    entries: z.array(updateEntry).max(100).optional(),
    transitions: z.array(updateTransition).max(100).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.entries?.length ?? 0) + (input.transitions?.length ?? 0) < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Provide at least one entry or transition.',
      });
    }
    const transitionIds = input.transitions?.map((transition) => transition.item_id) ?? [];
    if (new Set(transitionIds).size !== transitionIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: 'A Project Update item can be transitioned only once per update.',
      });
    }
  });

function commandOperationId(name: string, operationId: string | null): string {
  if (!operationId) {
    throw new ApplicationOperationContractError(name, { reason: 'missing_operation_id' });
  }
  return operationId;
}

function excerpt(value: string, maxLength = 500): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

const contextItemSchema = z
  .object({
    item_id: z.string(),
    update_id: z.string(),
    kind: projectUpdateKind,
    title: z.string(),
    detail_excerpt: z.string(),
    status: projectUpdateStatus,
    occurred_at: z.string(),
    created_by: z.string(),
    related_delivery_ids: z.array(z.string()).max(CONTEXT_DELIVERY_LINK_LIMIT),
    related_delivery_count: z.number().int().nonnegative(),
    related_delivery_ids_truncated: z.boolean(),
  })
  .strict();

export const recordProjectUpdateOperation: ApplicationOperationDefinition = {
  name: 'record_project_update',
  version: 1,
  description:
    'Record a durable, source-linked Project update before or during Delivery work, and optionally resolve earlier context items.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: recordProjectUpdateInput,
  outputSchema: z
    .object({
      status: z.literal('recorded'),
      project_id: z.string(),
      delivery_id: z.string().nullable(),
      update_id: z.string(),
      source_count: z.number().int().positive(),
      evidence_count: z.number().int().nonnegative(),
      entry_count: z.number().int().nonnegative(),
      transitioned_item_count: z.number().int().nonnegative(),
      entry_counts: z.record(z.string(), z.number().int().nonnegative()),
      affected_delivery_ids: z.array(z.string()),
      suggested_call: z.object({
        operation: z.literal('get_project_context'),
        input: z.object({ project_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const deliveryId = typeof input['delivery_id'] === 'string' ? input['delivery_id'] : null;
    if (!(await context.appCtx.db.getProject(projectId))) throw new ProjectNotFoundError(projectId);
    await context.appCtx.deliveryService.assertProjectCanMutate(projectId);

    if (deliveryId) {
      const delivery = await context.appCtx.db.requireDelivery(deliveryId);
      if (delivery.project_id !== projectId) {
        throw new ProjectUpdateProjectMismatchError(projectId, deliveryId, 'delivery');
      }
    }

    const artifactIds = (input['source_artifact_ids'] as string[] | undefined) ?? [];
    if (new Set(artifactIds).size !== artifactIds.length) {
      throw new ProjectUpdateSourceInvalidError('Artifact sources must not contain duplicates.');
    }
    const artifactRows = await context.appCtx.db.getArtifactProjectRowsByIds(artifactIds);
    const artifactById = new Map(artifactRows.map((row) => [row.artifact_id, row]));
    for (const artifactId of artifactIds) {
      const artifact = artifactById.get(artifactId);
      if (!artifact) throw new ArtifactNotFoundError(artifactId);
      if (artifact.project_id !== projectId) {
        throw new ProjectUpdateProjectMismatchError(projectId, artifactId, 'artifact');
      }
      if (deliveryId && artifact.delivery_id !== deliveryId) {
        throw new ProjectUpdateProjectMismatchError(projectId, artifactId, 'artifact_delivery');
      }
    }

    const explicitSourceInput =
      (input['sources'] as z.infer<typeof updateSource>[] | undefined) ?? [];
    explicitSourceInput.forEach(assertValidSource);
    const explicitSources = explicitSourceInput.map((source) => ({
      ...source,
    })) as ProjectUpdateSource[];
    const sources: ProjectUpdateSource[] = [
      ...explicitSources,
      ...artifactIds.map((artifactId) => ({
        source_type: 'other' as const,
        label: `Delivery artifact ${artifactId}`,
        artifact_id: artifactId,
      })),
    ];
    if (sources.length < 1 || sources.length > 20) {
      throw new ProjectUpdateSourceInvalidError('Project Updates require 1 to 20 sources.', {
        sourceCount: sources.length,
      });
    }

    const entries = ((input['entries'] as z.infer<typeof updateEntry>[] | undefined) ?? []).map(
      (entry) => ({
        kind: entry.kind,
        title: entry.title.trim(),
        detail: entry.detail.trim(),
        status: entry.status ?? defaultProjectUpdateStatus(entry.kind),
      }),
    );
    const transitions = (
      (input['transitions'] as z.infer<typeof updateTransition>[] | undefined) ?? []
    ).map((transition) => ({
      itemId: transition.item_id,
      expectedStatus: transition.expected_status,
      status: transition.status,
      note: transition.note.trim(),
    }));
    const operationId = commandOperationId('record_project_update', context.operationId);
    const invocation =
      typeof input['occurred_at'] === 'string'
        ? null
        : await context.appCtx.db.getApplicationOperationById(operationId);
    const result = await context.appCtx.db.recordProjectUpdate({
      id: `pupd_${operationId}`,
      projectId,
      deliveryId,
      summary: String(input['summary']).trim(),
      occurredAt:
        typeof input['occurred_at'] === 'string'
          ? new Date(input['occurred_at']).toISOString()
          : (invocation?.created_at ?? new Date().toISOString()),
      sources,
      entries,
      transitions,
      createdBy: context.actor.label,
    });
    const counts = Object.fromEntries(
      ['decision', 'action', 'risk', 'question', 'dependency', 'progress', 'fact'].map((kind) => [
        kind,
        result.items.filter((item) => item.kind === kind).length,
      ]),
    );
    return {
      status: 'recorded',
      project_id: projectId,
      delivery_id: deliveryId,
      update_id: result.update.id,
      source_count: sources.length,
      evidence_count: artifactIds.length,
      entry_count: result.items.length,
      transitioned_item_count: result.transitionedItemIds.length,
      entry_counts: counts,
      affected_delivery_ids: result.affectedDeliveryIds,
      suggested_call: { operation: 'get_project_context', input: { project_id: projectId } },
      _agent_guidance: {
        message:
          result.affectedDeliveryIds.length > 0
            ? 'The Project context is updated. Review the affected Deliveries because linked source information changed.'
            : 'The Project context is updated and can be read without creating a Delivery.',
        next_steps: [
          'Call get_project_context before planning the next implementation slice.',
          ...(result.affectedDeliveryIds.length > 0
            ? [
                'Review affected Deliveries and update their Definition of Done or Gates when needed.',
              ]
            : []),
        ],
      },
    };
  },
};

export const getProjectContextOperation: ApplicationOperationDefinition = {
  name: 'get_project_context',
  version: 1,
  description:
    'Read current Project decisions, open questions, dependencies, risks, actions, and recent source-linked updates.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      current_item_limit: z.number().int().min(1).max(50).default(50),
      recent_update_limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      project_id: z.string(),
      generated_at: z.string(),
      counts: z.object({
        total_by_kind: z.record(z.string(), z.number().int().nonnegative()),
        current_by_kind: z.record(z.string(), z.number().int().nonnegative()),
      }),
      current_items: z.array(contextItemSchema),
      recent_updates: z.array(
        z
          .object({
            update_id: z.string(),
            summary_excerpt: z.string(),
            occurred_at: z.string(),
            created_at: z.string(),
            created_by: z.string(),
            source_labels: z.array(z.string()).max(CONTEXT_SOURCE_LABEL_LIMIT),
            source_count: z.number().int().nonnegative(),
            sources_truncated: z.boolean(),
            item_count: z.number().int().nonnegative(),
          })
          .strict(),
      ),
      changed_delivery_context: z.array(
        z
          .object({
            delivery_id: z.string(),
            item_id: z.string(),
            linked_status: projectUpdateStatus,
            current_status: projectUpdateStatus,
          })
          .strict(),
      ),
      truncated: z.object({
        current_items: z.boolean(),
        recent_updates: z.boolean(),
        changed_delivery_context: z.boolean(),
      }),
      suggested_call: z
        .object({
          operation: z.literal('get_project_update'),
          input: z.object({ project_id: z.string(), update_id: z.string() }),
        })
        .nullable(),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    if (!(await context.appCtx.db.getProject(projectId))) throw new ProjectNotFoundError(projectId);
    const result = await context.appCtx.db.getProjectUpdateContext(
      projectId,
      Number(input['current_item_limit']),
      Number(input['recent_update_limit']),
    );
    const kinds: ProjectUpdateKind[] = [
      'decision',
      'action',
      'risk',
      'question',
      'dependency',
      'progress',
      'fact',
    ];
    const totalByKind = Object.fromEntries(
      kinds.map((kind) => [
        kind,
        Object.entries(result.counts)
          .filter(([key]) => key.startsWith(`${kind}:`))
          .reduce((total, [, value]) => total + value, 0),
      ]),
    );
    const currentByKind = Object.fromEntries(
      kinds.map((kind) => [
        kind,
        kind === 'decision'
          ? (result.counts['decision:accepted'] ?? 0)
          : ['action', 'risk', 'question', 'dependency'].includes(kind)
            ? (result.counts[`${kind}:open`] ?? 0)
            : 0,
      ]),
    );
    const latest = result.recentUpdates[0];
    return {
      status: 'ok',
      project_id: projectId,
      generated_at: new Date().toISOString(),
      counts: { total_by_kind: totalByKind, current_by_kind: currentByKind },
      current_items: result.currentItems.map(({ item, update, deliveryIds }) => {
        const sortedDeliveryIds = [...deliveryIds].sort();
        return {
          item_id: item.id,
          update_id: update.id,
          kind: item.kind,
          title: item.title,
          detail_excerpt: excerpt(item.detail),
          status: item.status,
          occurred_at: update.occurred_at,
          created_by: update.created_by,
          related_delivery_ids: sortedDeliveryIds.slice(0, CONTEXT_DELIVERY_LINK_LIMIT),
          related_delivery_count: sortedDeliveryIds.length,
          related_delivery_ids_truncated: sortedDeliveryIds.length > CONTEXT_DELIVERY_LINK_LIMIT,
        };
      }),
      recent_updates: result.recentUpdates.map((update) => ({
        update_id: update.id,
        summary_excerpt: excerpt(update.summary),
        occurred_at: update.occurred_at,
        created_at: update.created_at,
        created_by: update.created_by,
        source_labels: update.sources
          .slice(0, CONTEXT_SOURCE_LABEL_LIMIT)
          .map((source) => excerpt(source.label, 100)),
        source_count: update.sources.length,
        sources_truncated: update.sources.length > CONTEXT_SOURCE_LABEL_LIMIT,
        item_count: update.itemCount,
      })),
      changed_delivery_context: result.changedDeliveryContext.map((entry) => ({
        delivery_id: entry.deliveryId,
        item_id: entry.itemId,
        linked_status: entry.linkedStatus,
        current_status: entry.currentStatus,
      })),
      truncated: {
        current_items: result.currentItemsTruncated,
        recent_updates: result.recentUpdatesTruncated,
        changed_delivery_context: result.changedDeliveryContextTruncated,
      },
      suggested_call: latest
        ? {
            operation: 'get_project_update',
            input: { project_id: projectId, update_id: latest.id },
          }
        : null,
      _agent_guidance: {
        message:
          result.recentUpdates.length > 0
            ? 'Use current items as planning context and inspect a specific update only when full source detail is needed.'
            : 'No Project Updates are recorded yet. Record source-linked context before creating a Delivery.',
        next_steps:
          result.currentItems.length > 0
            ? ['Resolve or supersede stale context in the next record_project_update call.']
            : [],
      },
    };
  },
};

export const getProjectUpdateOperation: ApplicationOperationDefinition = {
  name: 'get_project_update',
  version: 1,
  description:
    'Read one durable Project Update with full sources, entries, transitions, and Delivery links.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z.object({ project_id: z.string().min(1), update_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      project_id: z.string(),
      update: z
        .object({
          update_id: z.string(),
          delivery_id: z.string().nullable(),
          summary: z.string(),
          occurred_at: z.string(),
          created_at: z.string(),
          created_by: z.string(),
          sources: z.array(
            z
              .object({
                source_type: z.enum(['repository', 'url', 'meeting', 'wbs', 'other']),
                label: z.string(),
                locator: z.string().optional(),
                revision: z.string().optional(),
                sha256: z.string().optional(),
                artifact_id: z.string().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
      entries: z.array(
        z
          .object({
            item_id: z.string(),
            kind: projectUpdateKind,
            title: z.string(),
            detail: z.string(),
            status: projectUpdateStatus,
            related_delivery_ids: z.array(z.string()),
          })
          .strict(),
      ),
      transitioned_items: z.array(
        z
          .object({
            item_id: z.string(),
            kind: projectUpdateKind,
            title: z.string(),
            from_update_id: z.string(),
            status: projectUpdateStatus,
            resolution_note: z.string().nullable(),
            related_delivery_ids: z.array(z.string()),
          })
          .strict(),
      ),
      related_delivery_ids: z.array(z.string()),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    if (!(await context.appCtx.db.getProject(projectId))) throw new ProjectNotFoundError(projectId);
    const detail = await context.appCtx.db.getProjectUpdateDetail(
      projectId,
      String(input['update_id']),
    );
    const relatedDeliveryIds = [
      ...new Set([
        ...(detail.update.delivery_id ? [detail.update.delivery_id] : []),
        ...[...detail.deliveryIdsByItem.values()].flat(),
      ]),
    ];
    return {
      status: 'ok',
      project_id: projectId,
      update: {
        update_id: detail.update.id,
        delivery_id: detail.update.delivery_id,
        summary: detail.update.summary,
        occurred_at: detail.update.occurred_at,
        created_at: detail.update.created_at,
        created_by: detail.update.created_by,
        sources: detail.update.sources,
      },
      entries: detail.items.map((item) => ({
        item_id: item.id,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        status: item.status,
        related_delivery_ids: detail.deliveryIdsByItem.get(item.id) ?? [],
      })),
      transitioned_items: detail.transitionedItems.map((item) => ({
        item_id: item.id,
        kind: item.kind,
        title: item.title,
        from_update_id: item.project_update_id,
        status: item.status,
        resolution_note: item.resolution_note,
        related_delivery_ids: detail.deliveryIdsByItem.get(item.id) ?? [],
      })),
      related_delivery_ids: relatedDeliveryIds,
      _agent_guidance: {
        message:
          'This Update is immutable. Correct it by recording a new Update and transitioning affected items.',
        next_steps: [],
      },
    };
  },
};

export const projectUpdateOperations = [
  recordProjectUpdateOperation,
  getProjectContextOperation,
  getProjectUpdateOperation,
] as const;
