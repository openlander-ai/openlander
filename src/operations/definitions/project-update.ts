import { z } from 'zod';

import { ArtifactNotFoundError, ArtifactValidationError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

const updateEntry = z
  .object({
    kind: z.enum(['decision', 'action', 'risk', 'question', 'fact']),
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(20_000),
    status: z.enum(['open', 'accepted', 'resolved', 'dismissed', 'noted']).default('noted'),
  })
  .strict();

export const recordProjectUpdateOperation: ApplicationOperationDefinition = {
  name: 'record_project_update',
  version: 1,
  description:
    'Record source-linked decisions, actions, risks, questions, and facts from project evidence.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      delivery_id: z.string().min(1),
      summary: z.string().trim().min(1).max(20_000),
      source_artifact_ids: z.array(z.string().min(1)).min(1).max(20),
      entries: z.array(updateEntry).min(1).max(100),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('recorded'),
      project_id: z.string(),
      delivery_id: z.string(),
      update_id: z.string(),
      evidence_count: z.number().int().positive(),
      entry_count: z.number().int().positive(),
      entry_counts: z.record(z.string(), z.number().int().nonnegative()),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const deliveryId = String(input['delivery_id']);
    const delivery = await context.appCtx.db.requireDelivery(deliveryId);
    if (delivery.project_id !== projectId) {
      throw new ArtifactValidationError('Delivery does not belong to the requested Project.', {
        projectId,
        deliveryId,
      });
    }
    await context.appCtx.deliveryService.assertProjectCanMutate(projectId);

    const artifactIds = input['source_artifact_ids'] as string[];
    const artifacts = await context.appCtx.db.getDeliveryArtifactsByIds(artifactIds);
    const found = new Set(artifacts.map((artifact) => artifact.id));
    const missing = artifactIds.find((artifactId) => !found.has(artifactId));
    if (missing) throw new ArtifactNotFoundError(missing);
    const wrongDelivery = artifacts.find((artifact) => artifact.delivery_id !== deliveryId);
    if (wrongDelivery) {
      throw new ArtifactValidationError('Source artifact belongs to a different Delivery.', {
        artifactId: wrongDelivery.id,
        deliveryId,
      });
    }

    const entries = input['entries'] as Array<z.infer<typeof updateEntry>>;
    const counts = Object.fromEntries(
      ['decision', 'action', 'risk', 'question', 'fact'].map((kind) => [
        kind,
        entries.filter((entry) => entry.kind === kind).length,
      ]),
    );
    const activity = await context.appCtx.db.insertActivityLog({
      event_type: 'project.update_recorded',
      activity_type: 'project_update',
      severity: entries.some((entry) => entry.kind === 'risk' && entry.status === 'open')
        ? 'warning'
        : 'info',
      project_id: projectId,
      correlation_id: deliveryId,
      title: 'Project update recorded',
      description: String(input['summary']),
      status: 'completed',
      metadata: JSON.stringify({
        delivery_id: deliveryId,
        source_artifact_ids: artifactIds,
        entries,
        actor: context.actor.label,
      }),
    });
    return {
      status: 'recorded',
      project_id: projectId,
      delivery_id: deliveryId,
      update_id: activity.id,
      evidence_count: artifactIds.length,
      entry_count: entries.length,
      entry_counts: counts,
      _agent_guidance: {
        message:
          'The structured project update is linked to immutable evidence and included in future internal weekly snapshots.',
        next_steps: [
          'Resolve open questions and risks before completing the Delivery.',
          'Rerun only Gates affected by the recorded change.',
        ],
      },
    };
  },
};

export const projectUpdateOperations = [recordProjectUpdateOperation] as const;
