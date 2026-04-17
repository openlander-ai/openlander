import os from 'node:os';

import { Hono } from 'hono';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import {
  CONFIG_VERSION,
  deserializeConfig,
  serializeConfig,
  type DeployConfigSnapshot,
} from '../../pipeline/config-snapshot.js';
import { buildResourceLimitConfig, RESOURCE_PROFILES } from '../../pipeline/docker/types.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
  return `${String(Math.floor(bytes / (1024 * 1024)))}MB`;
}

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createResourceRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // GET /api/projects/:id/resources
  api.get('/projects/:id/resources', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const configRow = ctx.db.loadDeployConfig(project.id);
    let snapshot: DeployConfigSnapshot = {};

    if (configRow) {
      const stored = deserializeConfig(configRow.config_json);
      if (stored?.snapshot) {
        snapshot = stored.snapshot;
      }
    }

    const response = buildResourceResponse(snapshot);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
    if (usedPercent > 85) {
      response.warnings = [
        `Host memory usage is at ${String(Math.round(usedPercent))}% (${formatBytes(freeMem)} free of ${formatBytes(totalMem)})`,
      ];
    }

    return c.json(response);
  });

  // PATCH /api/projects/:id/resources
  api.patch('/projects/:id/resources', async (c) => {
    const project = getProjectOrThrow(c, ctx);

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

    const { profile, memoryMb } = parsed.data;
    const maxMemoryBytes = Math.floor(os.totalmem() * 0.8);
    const maxMemoryMb = Math.floor(maxMemoryBytes / 1024 / 1024);

    if (profile === 'custom') {
      if (memoryMb !== undefined && memoryMb > maxMemoryMb) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: `memoryMb (${String(memoryMb)}) exceeds maximum allowed (${String(maxMemoryMb)}MB, 80% of host memory)`,
          },
          400,
        );
      }
    } else {
      const profileMemoryBytes = RESOURCE_PROFILES[profile].memoryLimitBytes;
      if (profileMemoryBytes > maxMemoryBytes) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: `Profile "${profile}" requires ${formatBytes(profileMemoryBytes)} but host allows max ${formatBytes(maxMemoryBytes)} (80% of host memory)`,
          },
          400,
        );
      }
    }

    let newResourceProfile: DeployConfigSnapshot['resourceProfile'];
    let newMemoryLimitBytes: number;

    if (profile === 'custom') {
      newResourceProfile = 'custom';
      const mb = memoryMb ?? 0;
      newMemoryLimitBytes = mb * 1024 * 1024;
    } else {
      newResourceProfile = profile;
      newMemoryLimitBytes = RESOURCE_PROFILES[profile].memoryLimitBytes;
    }

    const configRow = ctx.db.loadDeployConfig(project.id);
    let snapshot: DeployConfigSnapshot = {};
    if (configRow) {
      const stored = deserializeConfig(configRow.config_json);
      if (stored?.snapshot) {
        snapshot = { ...stored.snapshot };
      }
    }

    snapshot.resourceProfile = newResourceProfile;
    snapshot.memoryLimitBytes = newMemoryLimitBytes;

    ctx.db.saveDeployConfig(project.id, serializeConfig(snapshot), CONFIG_VERSION);

    return c.json(buildResourceResponse(snapshot));
  });

  return api;
}
