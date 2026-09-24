import os from 'node:os';

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import type { ProjectRow, ServiceRow } from '../../db/index.js';
import { isManagedServiceKind } from '../../db/repos/service.repo.js';
import {
  CONFIG_VERSION,
  deserializeConfig,
  serializeConfig,
  type DeployConfigSnapshot,
} from '../../pipeline/config-snapshot.js';
import { buildResourceLimitConfig } from '../../pipeline/docker/types.js';
import {
  applyResourceProfileUpdate,
  formatMemoryBytes,
  RESOURCE_PROFILE_NAMES,
  validateResourceProfileUpdate,
} from '../../pipeline/resource-limits-policy.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

// ─── Validation Schemas ────────────────────────────────────────────────────

export const UpdateResourceLimitsSchema = z
  .object({
    profile: z.enum(RESOURCE_PROFILE_NAMES),
    memoryMb: z.number().min(64).optional(),
  })
  .refine(
    (data) => data.profile !== 'custom' || (data.memoryMb !== undefined && data.memoryMb > 0),
    { message: 'memoryMb is required when profile is "custom"', path: ['memoryMb'] },
  );

export type UpdateResourceLimitsInput = z.infer<typeof UpdateResourceLimitsSchema>;

export const ResourceLimitsResponseSchema = z.object({
  profile: z.enum(RESOURCE_PROFILE_NAMES).nullable(),
  memory: z
    .object({
      limitBytes: z.number(),
      reservationBytes: z.number(),
      swapBytes: z.number(),
    })
    .nullable(),
  cpu: z.object({ shares: z.number() }).nullable(),
  warnings: z.array(z.string()).optional(),
  running: z.boolean().optional(),
});

export type ResourceLimitsResponse = z.infer<typeof ResourceLimitsResponseSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildResourceResponse(snapshot: DeployConfigSnapshot): ResourceLimitsResponse {
  const profile = snapshot.resourceProfile ?? null;
  const limits = buildResourceLimitConfig(snapshot.resourceProfile, snapshot.memoryLimitBytes);

  return {
    profile,
    memory: limits
      ? {
          limitBytes: limits.memoryLimitBytes,
          reservationBytes: limits.memoryReservationBytes,
          swapBytes: limits.memorySwapBytes,
        }
      : null,
    cpu: limits ? { shares: limits.cpuShares } : null,
  };
}

function readSnapshot(configJson: string | null | undefined): DeployConfigSnapshot {
  if (!configJson) return {};
  const stored = deserializeConfig(configJson);
  return stored?.snapshot ? { ...stored.snapshot } : {};
}

function formatBytes(bytes: number): string {
  return formatMemoryBytes(bytes);
}

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createResourceRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  async function resolveService(c: Context): Promise<
    | {
        project: ProjectRow;
        service: ServiceRow;
      }
    | Response
  > {
    const projectParam = c.req.param('p') ?? '';
    const serviceParam = c.req.param('s') ?? '';
    const project =
      (await ctx.db.getProject(projectParam)) ?? (await ctx.db.getProjectByName(projectParam));
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
    }

    const service = await ctx.db.getService(serviceParam);
    if (!service || service.project_id !== project.id) {
      return c.json({ error: 'NOT_FOUND', message: `Service not found: ${serviceParam}` }, 404);
    }

    return { project, service };
  }

  async function loadSnapshotForService(serviceId: string): Promise<DeployConfigSnapshot> {
    const configRow = await ctx.db.loadDeployConfigForService(serviceId);
    return readSnapshot(configRow?.config_json);
  }

  async function saveSnapshotForService(
    serviceId: string,
    snapshot: DeployConfigSnapshot,
  ): Promise<void> {
    await ctx.db.saveDeployConfigForService(serviceId, serializeConfig(snapshot), CONFIG_VERSION);
  }

  function validateMemoryProfile(profile: UpdateResourceLimitsInput['profile'], memoryMb?: number) {
    return validateResourceProfileUpdate({
      profile,
      ...(memoryMb === undefined ? {} : { memoryMb }),
    });
  }

  function applyResourceUpdate(
    snapshot: DeployConfigSnapshot,
    input: UpdateResourceLimitsInput,
  ): DeployConfigSnapshot {
    return applyResourceProfileUpdate(snapshot, input);
  }

  function appendHostMemoryWarnings(response: ResourceLimitsResponse): ResourceLimitsResponse {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
    if (usedPercent > 85) {
      return {
        ...response,
        warnings: [
          `Host memory usage is at ${String(Math.round(usedPercent))}% (${formatBytes(freeMem)} free of ${formatBytes(totalMem)})`,
        ],
      };
    }
    return response;
  }

  // GET /api/projects/:p/services/:s/resources
  api.get('/projects/:p/services/:s/resources', async (c) => {
    const resolved = await resolveService(c);
    if (resolved instanceof Response) return resolved;

    if (isManagedServiceKind(resolved.service.kind)) {
      return c.json(await ctx.serviceManager.getResourceLimits(resolved.service.id));
    }

    const snapshot = await loadSnapshotForService(resolved.service.id);
    return c.json(appendHostMemoryWarnings(buildResourceResponse(snapshot)));
  });

  // PATCH /api/projects/:p/services/:s/resources
  api.patch('/projects/:p/services/:s/resources', async (c) => {
    const resolved = await resolveService(c);
    if (resolved instanceof Response) return resolved;

    const body: unknown = await c.req.json();
    const parsed = UpdateResourceLimitsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
        400,
      );
    }

    const validationError = validateMemoryProfile(parsed.data.profile, parsed.data.memoryMb);
    if (validationError) {
      return c.json({ error: 'VALIDATION_ERROR', message: validationError }, 400);
    }

    if (isManagedServiceKind(resolved.service.kind)) {
      return c.json(
        await ctx.serviceManager.updateResourceLimits(resolved.service.id, parsed.data),
      );
    }

    const snapshot = applyResourceUpdate(
      await loadSnapshotForService(resolved.service.id),
      parsed.data,
    );
    await saveSnapshotForService(resolved.service.id, snapshot);

    return c.json(buildResourceResponse(snapshot));
  });

  // GET /api/projects/:id/resources
  api.get('/projects/:id/resources', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const configRow = await ctx.db.loadDeployConfig(project.id);
    const snapshot = readSnapshot(configRow?.config_json);

    return c.json(appendHostMemoryWarnings(buildResourceResponse(snapshot)));
  });

  // PATCH /api/projects/:id/resources
  api.patch('/projects/:id/resources', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const body: unknown = await c.req.json();
    const parsed = UpdateResourceLimitsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
        400,
      );
    }

    const validationError = validateMemoryProfile(parsed.data.profile, parsed.data.memoryMb);
    if (validationError) {
      return c.json({ error: 'VALIDATION_ERROR', message: validationError }, 400);
    }

    const configRow = await ctx.db.loadDeployConfig(project.id);
    const snapshot = applyResourceUpdate(readSnapshot(configRow?.config_json), parsed.data);

    await ctx.db.saveDeployConfig(project.id, serializeConfig(snapshot), CONFIG_VERSION);

    return c.json(buildResourceResponse(snapshot));
  });

  return api;
}
