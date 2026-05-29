import type { AppContext } from '../../../app.js';
import { getProjectUrl } from '../../../pipeline/traefik.js';
import { normalizeTimestamp } from './project-route-shared.js';

/**
 * Shape returned by both preview-list endpoints:
 *   - project-compat `/projects/:id/previews`
 *   - service-aux    `/projects/:p/services/:s/previews`
 *
 * Until R3 the projection was inlined byte-for-byte in both routes
 * (modulo the Hono context name). Centralizing it here makes the
 * preview surface the single read-model the eventual service-first
 * migration can target without a multi-route fan-out.
 */
export interface PreviewProjection {
  id: string;
  name: string;
  /** May surface `undefined` from a preview row that pre-dates the column. */
  status: string | null | undefined;
  prNumber: number | null | undefined;
  url: string;
  publicUrl: string | null | undefined;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Resolve the preview list for a parent project. Each entry's runtime
 * fields fall back deployable → preview row → null, matching the inline
 * blocks in both routes:
 *
 *   - `status` falls back deployable.status → preview.status
 *   - `publicUrl` falls back deployable.public_url → preview.public_url
 *   - `url` is always `getProjectUrl(preview.name)` (no port query)
 *   - `prNumber`, `createdAt`, `updatedAt` come from the preview row
 *
 * Concurrency stays the caller's pre-R3 `Promise.all` per-preview
 * fan-out — preserving wall-time semantics for small N preview lists.
 */
export async function loadPreviewProjections(
  ctx: Pick<AppContext, 'db'>,
  parentProjectId: string,
): Promise<PreviewProjection[]> {
  const previews = await ctx.db.getPreviewProjects(parentProjectId);
  return Promise.all(
    previews.map(async (preview) => {
      // PR 4 canonical-first: status + public_url from the preview's
      // deployable services row when available; fall back to legacy
      // preview-row columns through migration 0012.
      const deployable = await ctx.db.getDeployableForProject(preview.id);
      return {
        id: preview.id,
        name: preview.name,
        status: deployable?.status ?? preview.status,
        prNumber: preview.pr_number,
        url: getProjectUrl(preview.name),
        publicUrl: deployable?.public_url ?? preview.public_url,
        createdAt: normalizeTimestamp(preview.created_at),
        updatedAt: normalizeTimestamp(preview.updated_at),
      };
    }),
  );
}
