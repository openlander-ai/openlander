import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { loadPreviewProjections } from '../../src/web/api/helpers/preview-projection.js';

function makePreviewRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'preview-1',
    name: 'preview-1',
    display_name: 'Preview 1',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'preview-1__svc',
    project_id: 'preview-1',
    name: 'preview-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 9100,
    container_id: 'container-1',
    container_name: 'ol-preview-1',
    container_port: 3000,
    image_tag: 'preview-1:tag',
    previous_image_tag: null,
    public_url: 'https://canonical-public.example.com',
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 1,
    pr_number: 42,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeCtx(overrides: {
  previews?: ProjectRow[];
  deployableByPreviewId?: Map<string, ServiceRow | undefined>;
}): Pick<AppContext, 'db'> {
  return {
    db: {
      getPreviewProjects: vi.fn(async () => overrides.previews ?? []),
      getDeployableForProject: vi.fn(async (id: string) =>
        overrides.deployableByPreviewId?.get(id),
      ),
    } as unknown as AppContext['db'],
  };
}

describe('loadPreviewProjections', () => {
  it('prefers deployable status / public_url and tunnels preview metadata through', async () => {
    const ctx = makeCtx({
      previews: [makePreviewRow({ status: 'stopped', public_url: 'legacy-url', pr_number: 7 })],
      deployableByPreviewId: new Map([['preview-1', makeServiceRow()]]),
    });

    const result = await loadPreviewProjections(ctx, 'parent-id');

    expect(result).toEqual([
      {
        id: 'preview-1',
        name: 'preview-1',
        status: 'running',
        prNumber: 7,
        url: expect.stringContaining('preview-1'),
        publicUrl: 'https://canonical-public.example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(ctx.db.getPreviewProjects).toHaveBeenCalledWith('parent-id');
  });

  it('falls back to preview-row status / public_url when no deployable exists', async () => {
    const ctx = makeCtx({
      previews: [makePreviewRow({ status: 'stopped', public_url: 'legacy-url', pr_number: 9 })],
      deployableByPreviewId: new Map(),
    });

    const result = await loadPreviewProjections(ctx, 'parent-id');

    expect(result[0]).toMatchObject({
      status: 'stopped',
      publicUrl: 'legacy-url',
      prNumber: 9,
    });
  });

  it('returns an empty list when the parent has no previews (no deployable lookups)', async () => {
    const ctx = makeCtx({ previews: [] });
    const result = await loadPreviewProjections(ctx, 'parent-id');

    expect(result).toEqual([]);
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('fans out one deployable lookup per preview', async () => {
    const ctx = makeCtx({
      previews: [
        makePreviewRow({ id: 'p1', name: 'p1' }),
        makePreviewRow({ id: 'p2', name: 'p2' }),
        makePreviewRow({ id: 'p3', name: 'p3' }),
      ],
      deployableByPreviewId: new Map(),
    });

    await loadPreviewProjections(ctx, 'parent-id');

    expect(ctx.db.getDeployableForProject).toHaveBeenCalledTimes(3);
    expect(ctx.db.getDeployableForProject).toHaveBeenNthCalledWith(1, 'p1');
    expect(ctx.db.getDeployableForProject).toHaveBeenNthCalledWith(2, 'p2');
    expect(ctx.db.getDeployableForProject).toHaveBeenNthCalledWith(3, 'p3');
  });
});
