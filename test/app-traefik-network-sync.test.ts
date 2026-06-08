import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { syncManagedTraefikProjectNetworks } from '../src/app.js';

function createSyncContext(params: {
  mode?: 'managed' | 'external';
  projects: Array<{ id: string; name: string }>;
  services: Array<{
    project_id: string;
    status: string;
    container_id: string | null;
    archived_at: string | null;
  }>;
}): {
  ctx: Pick<AppContext, 'config' | 'db' | 'traefik'>;
  connectToNetwork: ReturnType<typeof vi.fn>;
} {
  const connectToNetwork = vi.fn(async () => undefined);
  const ctx = {
    config: {
      traefik: {
        mode: params.mode ?? 'managed',
      },
    },
    db: {
      listProjects: vi.fn(async () => params.projects),
      listServices: vi.fn(async () => params.services),
    },
    traefik: {
      connectToNetwork,
    },
  } as unknown as Pick<AppContext, 'config' | 'db' | 'traefik'>;

  return { ctx, connectToNetwork };
}

describe('syncManagedTraefikProjectNetworks', () => {
  it('reconnects Traefik to active project networks on managed startup', async () => {
    const { ctx, connectToNetwork } = createSyncContext({
      projects: [
        { id: 'p1', name: 'ledgerly' },
        { id: 'p2', name: 'stack' },
        { id: 'p3', name: 'stopped-app' },
      ],
      services: [
        { project_id: 'p1', status: 'running', container_id: 'c1', archived_at: null },
        { project_id: 'p1', status: 'running', container_id: 'c1b', archived_at: null },
        { project_id: 'p2', status: 'building', container_id: 'c2', archived_at: null },
        { project_id: 'p3', status: 'stopped', container_id: 'c3', archived_at: null },
        { project_id: 'p2', status: 'running', container_id: 'c4', archived_at: '2026-06-08' },
        { project_id: 'missing', status: 'running', container_id: 'c5', archived_at: null },
      ],
    });

    await syncManagedTraefikProjectNetworks(ctx);

    expect(connectToNetwork).toHaveBeenCalledTimes(2);
    expect(connectToNetwork).toHaveBeenCalledWith('ol-ledgerly');
    expect(connectToNetwork).toHaveBeenCalledWith('ol-stack');
  });

  it('does not attach project networks for external Traefik mode', async () => {
    const { ctx, connectToNetwork } = createSyncContext({
      mode: 'external',
      projects: [{ id: 'p1', name: 'ledgerly' }],
      services: [{ project_id: 'p1', status: 'running', container_id: 'c1', archived_at: null }],
    });

    await syncManagedTraefikProjectNetworks(ctx);

    expect(connectToNetwork).not.toHaveBeenCalled();
  });
});
