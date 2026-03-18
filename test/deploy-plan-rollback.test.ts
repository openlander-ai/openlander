import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RollbackWatcher } from '../src/monitor/rollback-watcher.js';
import { EventBus } from '../src/events/index.js';
import type { Database } from '../src/db/index.js';
import type { DeployPipeline } from '../src/pipeline/deploy.js';

function createMockDb(overrides?: {
  previous_image_tag?: string | null;
  name?: string;
  returnNull?: boolean;
}): Database {
  return {
    getProject: vi.fn().mockReturnValue(
      overrides?.returnNull
        ? null
        : {
            name: overrides?.name ?? 'test-project',
            previous_image_tag:
              'previous_image_tag' in (overrides ?? {})
                ? overrides?.previous_image_tag
                : 'old-image:v1',
          },
    ),
    updateDeployPlanStatus: vi.fn(),
  } as unknown as Database;
}

function createMockPipeline(): DeployPipeline {
  return {
    rollback: vi.fn().mockResolvedValue({
      success: true,
      projectId: 'p1',
      projectName: 'test-project',
    }),
  } as unknown as DeployPipeline;
}

describe('RollbackWatcher - Plan Deploy Auto-Rollback', () => {
  let events: EventBus;
  let db: Database;
  let pipeline: DeployPipeline;
  let watcher: RollbackWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    events = new EventBus();
    db = createMockDb();
    pipeline = createMockPipeline();
    watcher = new RollbackWatcher(events, db, pipeline);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('auto-executes rollback for plan deploy after 3 health failures', async () => {
    watcher.start();

    const rollbackSuggestedHandler = vi.fn();
    events.on('rollback:suggested', rollbackSuggestedHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
      planId: 'plan-123',
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(pipeline.rollback).toHaveBeenCalledWith('p1');
    expect(rollbackSuggestedHandler).not.toHaveBeenCalled();
  });

  it('updates plan status to rolled_back after auto-rollback', async () => {
    watcher.start();

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
      planId: 'plan-123',
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(db.updateDeployPlanStatus).toHaveBeenCalledWith('plan-123', 'rolled_back');
  });

  it('emits rollback:suggested for non-plan deploy after 3 health failures', async () => {
    watcher.start();

    const rollbackSuggestedHandler = vi.fn();
    events.on('rollback:suggested', rollbackSuggestedHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackSuggestedHandler).toHaveBeenCalledOnce();
    expect(rollbackSuggestedHandler).toHaveBeenCalledWith({
      projectId: 'p1',
      projectName: 'test-project',
      consecutiveFailures: 3,
      previousImageTag: 'old-image:v1',
    });
    expect(pipeline.rollback).not.toHaveBeenCalled();
    expect(db.updateDeployPlanStatus).not.toHaveBeenCalled();
  });

  it('emits rollback:suggested when pipeline is not available', async () => {
    const watcherNoPipeline = new RollbackWatcher(events, db);
    watcherNoPipeline.start();

    const rollbackSuggestedHandler = vi.fn();
    events.on('rollback:suggested', rollbackSuggestedHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
      planId: 'plan-123',
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackSuggestedHandler).toHaveBeenCalledOnce();
    expect(db.updateDeployPlanStatus).not.toHaveBeenCalled();
    watcherNoPipeline.stop();
  });

  it('handles rollback failure gracefully', async () => {
    const failingPipeline = {
      rollback: vi.fn().mockResolvedValue({
        success: false,
        projectId: 'p1',
        projectName: 'test-project',
        error: 'Rollback failed',
      }),
    } as unknown as DeployPipeline;

    const watcherWithFailingPipeline = new RollbackWatcher(events, db, failingPipeline);
    watcherWithFailingPipeline.start();

    const rollbackSuggestedHandler = vi.fn();
    events.on('rollback:suggested', rollbackSuggestedHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
      planId: 'plan-123',
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(failingPipeline.rollback).toHaveBeenCalledWith('p1');
    expect(db.updateDeployPlanStatus).not.toHaveBeenCalled();
    expect(rollbackSuggestedHandler).not.toHaveBeenCalled();
    watcherWithFailingPipeline.stop();
  });
});
