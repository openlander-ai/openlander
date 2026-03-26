import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
import { eventBus } from '../../../src/events/index.js';
import { TunnelManager } from '../../../src/pipeline/deploy/tunnel.js';

const tunnelMocks = {
  start: vi.fn<(...args: unknown[]) => Promise<string>>(),
  stop: vi.fn<(...args: unknown[]) => void>(),
  constructed: vi.fn<(...args: unknown[]) => void>(),
};

vi.mock('../../../src/pipeline/tunnel.js', () => {
  class MockCloudflareTunnel {
    constructor() {
      tunnelMocks.constructed();
    }

    start = tunnelMocks.start;

    stop = tunnelMocks.stop;
  }

  return { CloudflareTunnel: MockCloudflareTunnel };
});

describe('TunnelManager', () => {
  let tmpDir: string;
  let db: Database;
  let manager: TunnelManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    tunnelMocks.start.mockReset();
    tunnelMocks.stop.mockReset();
    tunnelMocks.constructed.mockReset();

    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-tunnel-manager-'));
    db = new Database(join(tmpDir, 'test.db'));
    manager = new TunnelManager(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('expose() creates tunnel and emits tunnel:url event', async () => {
    db.createProject({
      id: 'p1',
      name: 'quick-app',
      repoUrl: 'https://github.com/openlander/quick-app',
      branch: 'main',
    });
    tunnelMocks.start.mockResolvedValueOnce('https://quick-app.trycloudflare.com');
    const emitSpy = vi.spyOn(eventBus, 'emit');

    const url = await manager.expose('p1', 10001);

    expect(url).toBe('https://quick-app.trycloudflare.com');
    expect(tunnelMocks.constructed).toHaveBeenCalledOnce();
    expect(tunnelMocks.start).toHaveBeenCalledWith('quick-app');
    expect(emitSpy).toHaveBeenCalledWith('tunnel:url', {
      projectId: 'p1',
      url: 'https://quick-app.trycloudflare.com',
    });
  });

  it('get() returns tunnel after expose', async () => {
    db.createProject({
      id: 'p2',
      name: 'lookup-app',
      repoUrl: 'https://github.com/openlander/lookup-app',
      branch: 'main',
    });
    tunnelMocks.start.mockResolvedValueOnce('https://lookup.trycloudflare.com');

    await manager.expose('p2', 10002);
    const tunnel = manager.get('p2');

    expect(tunnel).toBeDefined();
  });

  it('close() removes tunnel from map and resets DB visibility', async () => {
    db.createProject({
      id: 'p3',
      name: 'close-app',
      repoUrl: 'https://github.com/openlander/close-app',
      branch: 'main',
    });
    db.updateProject('p3', {
      visibility: 'quick-share',
      publicUrl: 'https://close.trycloudflare.com',
    });
    tunnelMocks.start.mockResolvedValueOnce('https://close.trycloudflare.com');

    await manager.expose('p3', 10003);
    manager.close('p3');

    expect(tunnelMocks.stop).toHaveBeenCalledOnce();
    expect(manager.get('p3')).toBeUndefined();
    expect(db.getProject('p3')?.visibility).toBe('internal');
    expect(db.getProject('p3')?.public_url).toBeNull();
  });

  it('cleanupStale() resets quick-share/shared projects to internal on startup', () => {
    db.createProject({
      id: 'p4',
      name: 'quick-stale-app',
      repoUrl: 'https://github.com/openlander/quick-stale-app',
      branch: 'main',
    });
    db.createProject({
      id: 'p5',
      name: 'shared-stale-app',
      repoUrl: 'https://github.com/openlander/shared-stale-app',
      branch: 'main',
    });
    db.updateProject('p4', {
      visibility: 'quick-share',
      publicUrl: 'https://quick-stale.example.com',
    });
    db.updateProject('p5', {
      visibility: 'shared',
      publicUrl: 'https://shared-stale.example.com',
    });

    manager.cleanupStale();

    expect(db.getProject('p4')?.visibility).toBe('internal');
    expect(db.getProject('p4')?.public_url).toBeNull();
    expect(db.getProject('p5')?.visibility).toBe('internal');
    expect(db.getProject('p5')?.public_url).toBeNull();
  });

  it('close() on non-existent tunnel does not throw', () => {
    db.createProject({
      id: 'p6',
      name: 'missing-tunnel-app',
      repoUrl: 'https://github.com/openlander/missing-tunnel-app',
      branch: 'main',
    });

    expect(() => manager.close('p6')).not.toThrow();
    expect(db.getProject('p6')?.visibility).toBe('internal');
  });
});
