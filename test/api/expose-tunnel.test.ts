import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { TunnelStartError } from '../../src/errors.js';
import { exposeProjectTunnel } from '../../src/web/api/helpers/expose-tunnel.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p-1',
    name: 'p-1',
    display_name: 'P 1',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p-1__svc',
    project_id: 'p-1',
    name: 'p-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 9100,
    container_id: 'container-1',
    container_name: 'ol-p1',
    container_port: 3000,
    image_tag: 'p-1:tag',
    previous_image_tag: null,
    public_url: null,
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
    is_preview: null,
    pr_number: null,
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
  deployable?: ServiceRow | undefined;
  exposeTunnel?: ReturnType<typeof vi.fn>;
}): Pick<AppContext, 'db' | 'pipeline'> {
  return {
    db: {
      getDeployableForProject: vi.fn(async () => overrides.deployable),
    } as unknown as AppContext['db'],
    pipeline: {
      exposeTunnel: overrides.exposeTunnel ?? vi.fn(async () => 'https://tunnel.example.com'),
    } as unknown as AppContext['pipeline'],
  };
}

describe('exposeProjectTunnel', () => {
  it('returns exposed with the tunnel url when the deployable has an assigned_port', async () => {
    const exposeTunnel = vi.fn(async () => 'https://tunnel.example.com/abc');
    const ctx = makeCtx({ deployable: makeServiceRow({ assigned_port: 9100 }), exposeTunnel });
    const result = await exposeProjectTunnel(ctx, makeProjectRow());

    expect(result).toEqual({ kind: 'exposed', publicUrl: 'https://tunnel.example.com/abc' });
    expect(exposeTunnel).toHaveBeenCalledWith('p-1', 9100);
  });

  it('falls back to project.assigned_port when no deployable exists', async () => {
    const exposeTunnel = vi.fn(async () => 'https://tunnel.example.com/legacy');
    const ctx = makeCtx({ deployable: undefined, exposeTunnel });
    const result = await exposeProjectTunnel(ctx, makeProjectRow({ assigned_port: 8080 }));

    expect(result).toEqual({ kind: 'exposed', publicUrl: 'https://tunnel.example.com/legacy' });
    expect(exposeTunnel).toHaveBeenCalledWith('p-1', 8080);
  });

  it('returns not-running when neither deployable nor project resolves a port', async () => {
    const exposeTunnel = vi.fn(async () => 'should-not-call');
    const ctx = makeCtx({
      deployable: makeServiceRow({ assigned_port: null }),
      exposeTunnel,
    });
    const result = await exposeProjectTunnel(ctx, makeProjectRow({ assigned_port: null }));

    expect(result).toEqual({ kind: 'not-running' });
    expect(exposeTunnel).not.toHaveBeenCalled();
  });

  it('classifies TunnelStartError as tunnel-failed', async () => {
    const exposeTunnel = vi.fn(async () => {
      throw new TunnelStartError('cloudflared offline');
    });
    const ctx = makeCtx({ deployable: makeServiceRow(), exposeTunnel });
    const result = await exposeProjectTunnel(ctx, makeProjectRow());

    expect(result).toEqual({ kind: 'tunnel-failed' });
  });

  it('re-throws non-TunnelStartError exceptions so upstream handlers still see them', async () => {
    const exposeTunnel = vi.fn(async () => {
      throw new Error('pipeline panic');
    });
    const ctx = makeCtx({ deployable: makeServiceRow(), exposeTunnel });

    await expect(exposeProjectTunnel(ctx, makeProjectRow())).rejects.toThrow('pipeline panic');
  });
});
