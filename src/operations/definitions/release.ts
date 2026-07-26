import { z } from 'zod';

import type { AppContext } from '../../app.js';
import { ApplicationOperationContractError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

async function projectForRelease(input: Record<string, unknown>, appCtx: AppContext) {
  const release = await appCtx.db.requireRelease(String(input['release_id']));
  const delivery = await appCtx.db.requireDelivery(release.delivery_id);
  return { projectId: delivery.project_id };
}

async function projectForEnvironment(input: Record<string, unknown>, appCtx: AppContext) {
  const environment = await appCtx.db.getProjectEnvironment(
    String(input['project_environment_id']),
  );
  return { projectId: environment?.project_id };
}

async function projectForPromotion(input: Record<string, unknown>, appCtx: AppContext) {
  const promotion = await appCtx.db.getReleasePromotion(String(input['promotion_id']));
  if (!promotion) return {};
  const release = await appCtx.db.requireRelease(promotion.release_id);
  const delivery = await appCtx.db.requireDelivery(release.delivery_id);
  return { projectId: delivery.project_id };
}

function requireOperationId(name: string, operationId: string | null): string {
  if (!operationId) {
    throw new ApplicationOperationContractError(name, { reason: 'missing_command_operation_id' });
  }
  return operationId;
}

export const createReleaseOperation: ApplicationOperationDefinition = {
  name: 'create_release',
  version: 1,
  description: 'Build one immutable Release from a successful Agent Run.',
  kind: 'command',
  execution: 'async',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: async (input, appCtx) => ({
    projectId: await appCtx.deliveryAgentRunService.projectIdForRun(String(input['run_id'])),
  }),
  inputSchema: z
    .object({
      run_id: z.string().min(1),
      version: z.string().trim().min(1).max(100),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('building'),
      project_id: z.string(),
      delivery_id: z.string(),
      run_id: z.string(),
      release_id: z.string(),
      status_call: z.object({
        operation: z.literal('get_release'),
        input: z.object({ release_id: z.string() }),
      }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const operationId = requireOperationId('create_release', context.operationId);
    const run = await context.appCtx.db.requireDeliveryAgentRun(String(input['run_id']));
    const delivery = await context.appCtx.db.requireDelivery(run.delivery_id);
    const releaseId = `rel_${operationId}`;
    await context.appCtx.releaseService.start({
      id: releaseId,
      runId: run.id,
      version: String(input['version']),
      actor: context.actor.label,
    });
    return {
      status: 'building',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      run_id: run.id,
      release_id: releaseId,
      status_call: { operation: 'get_release', input: { release_id: releaseId } },
    };
  },
};

export const getReleaseOperation: ApplicationOperationDefinition = {
  name: 'get_release',
  version: 1,
  description: 'Read Release artifacts and Promotion history.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRelease,
  inputSchema: z.object({ release_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    status: z.literal('ok'),
    project_id: z.string(),
    delivery_id: z.string(),
    release: z.record(z.string(), z.unknown()),
    artifacts: z.array(z.record(z.string(), z.unknown())),
    promotions: z.array(z.record(z.string(), z.unknown())),
  }),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const detail = await context.appCtx.releaseService.get(String(input['release_id']));
    const delivery = await context.appCtx.db.requireDelivery(detail.release.delivery_id);
    return {
      status: 'ok',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      ...detail,
    };
  },
};

export const promoteReleaseOperation: ApplicationOperationDefinition = {
  name: 'promote_release',
  version: 1,
  description: 'Promote an existing immutable Release digest to the next Project Environment.',
  kind: 'command',
  execution: 'async',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRelease,
  inputSchema: z
    .object({
      release_id: z.string().min(1),
      project_environment_id: z.string().min(1),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('deploying'),
      project_id: z.string(),
      release_id: z.string(),
      promotion_id: z.string(),
      project_environment_id: z.string(),
      status_call: z.object({
        operation: z.literal('evaluate_promotion'),
        input: z.object({ promotion_id: z.string() }),
      }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const operationId = requireOperationId('promote_release', context.operationId);
    const release = await context.appCtx.db.requireRelease(String(input['release_id']));
    const delivery = await context.appCtx.db.requireDelivery(release.delivery_id);
    const promotionId = `prom_${operationId}`;
    await context.appCtx.releasePromotionService.start({
      id: promotionId,
      releaseId: release.id,
      projectEnvironmentId: String(input['project_environment_id']),
      idempotencyKey: operationId,
      actor: context.actor.label,
    });
    return {
      status: 'deploying',
      project_id: delivery.project_id,
      release_id: release.id,
      promotion_id: promotionId,
      project_environment_id: String(input['project_environment_id']),
      status_call: { operation: 'evaluate_promotion', input: { promotion_id: promotionId } },
    };
  },
};

export const evaluatePromotionOperation: ApplicationOperationDefinition = {
  name: 'evaluate_promotion',
  version: 1,
  description: 'Read Promotion health, soak, deploy identifiers, and failure details.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForPromotion,
  inputSchema: z.object({ promotion_id: z.string().min(1) }).strict(),
  outputSchema: z.object({ status: z.literal('ok'), promotion: z.record(z.string(), z.unknown()) }),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => ({
    status: 'ok',
    promotion: await context.appCtx.releasePromotionService.evaluate(String(input['promotion_id'])),
  }),
};

export const recallReleaseOperation: ApplicationOperationDefinition = {
  name: 'recall_release',
  version: 1,
  description: 'Prevent a ready Release from being promoted further.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRelease,
  inputSchema: z.object({ release_id: z.string().min(1) }).strict(),
  outputSchema: z.object({ status: z.literal('recalled'), release_id: z.string() }),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const release = await context.appCtx.releaseService.recall(
      String(input['release_id']),
      context.actor.label,
    );
    return { status: 'recalled', release_id: release.id };
  },
};

export const rollbackEnvironmentOperation: ApplicationOperationDefinition = {
  name: 'rollback_environment',
  version: 1,
  description: 'Restore the previous successful immutable Release in one Project Environment.',
  kind: 'command',
  execution: 'async',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForEnvironment,
  inputSchema: z.object({ project_environment_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    status: z.literal('rolled_back'),
    result: z.record(z.string(), z.unknown()),
  }),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => ({
    status: 'rolled_back',
    result: await context.appCtx.releasePromotionService.rollback({
      projectEnvironmentId: String(input['project_environment_id']),
      actor: context.actor.label,
    }),
  }),
};

export const releaseOperations = [
  createReleaseOperation,
  getReleaseOperation,
  promoteReleaseOperation,
  evaluatePromotionOperation,
  recallReleaseOperation,
  rollbackEnvironmentOperation,
] as const;
