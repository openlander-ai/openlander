import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { eventBus } from '../../src/events/index.js';
import { ContainerLifecycle } from '../../src/pipeline/deploy/lifecycle.js';
import type { Docker } from '../../src/pipeline/docker.js';

describe('ContainerLifecycle unarchive idempotency', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not allocate a new port or emit restore events when the project is already active', async () => {
    const db = {
      getProject: vi.fn().mockResolvedValue({
        id: 'project-1',
        archived_at: null,
      }),
      getDeployableForProject: vi.fn().mockResolvedValue({
        id: 'project-1__svc',
        archived_at: null,
      }),
      unarchiveProject: vi.fn().mockResolvedValue(undefined),
      updateProject: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = {
      listAllContainers: vi.fn().mockResolvedValue([]),
    };
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
    const lifecycle = new ContainerLifecycle(
      runtime as unknown as Docker,
      db as unknown as Database,
    );

    await lifecycle.unarchive('project-1');

    expect(db.getProject).toHaveBeenCalledWith('project-1');
    expect(db.getDeployableForProject).toHaveBeenCalledWith('project-1');
    expect(db.unarchiveProject).not.toHaveBeenCalled();
    expect(db.updateProject).not.toHaveBeenCalled();
    expect(runtime.listAllContainers).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalledWith('project:unarchive', expect.anything());
  });
});
