import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupRecoveryPostmortemAutomation } from '../src/app.js';
import type { ProjectRow } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';

function createProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-1',
    name: 'project-1',
    repo_url: 'https://example.com/repo.git',
    branch: 'main',
    status: 'running',
    visibility: 'internal',
    assigned_port: 3000,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    image_url: null,
    image_cmd: null,
    container_port: 3000,
    pending_fix: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    deploy_lock_session: null,
    deploy_lock_at: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    ...overrides,
  };
}

describe('setupRecoveryPostmortemAutomation', () => {
  let events: EventBus;
  let getProject: ReturnType<typeof vi.fn<(id: string) => ProjectRow | undefined>>;
  let generatePostmortem: ReturnType<typeof vi.fn<(projectId: string) => Promise<void>>>;
  let stop: (() => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    events = new EventBus();
    getProject = vi
      .fn<(id: string) => ProjectRow | undefined>()
      .mockReturnValue(createProjectRow());
    generatePostmortem = vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined);
    stop = null;
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it('generates a postmortem after the stability window when the project is still running', async () => {
    stop = setupRecoveryPostmortemAutomation({
      eventBus: events,
      db: { getProject },
      getPostmortem: () => ({ generatePostmortem }),
      delayMs: 5 * 60 * 1000,
    });

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(getProject).toHaveBeenCalledWith('project-1');
    expect(generatePostmortem).toHaveBeenCalledWith('project-1');
  });

  it('skips generation when the project is no longer running at timer expiry', async () => {
    getProject.mockReturnValue(createProjectRow({ status: 'stopped' }));

    stop = setupRecoveryPostmortemAutomation({
      eventBus: events,
      db: { getProject },
      getPostmortem: () => ({ generatePostmortem }),
      delayMs: 5 * 60 * 1000,
    });

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(generatePostmortem).not.toHaveBeenCalled();
  });

  it.each(['recovery:failed', 'recovery:exhausted', 'deploy:failed'] as const)(
    'cancels the pending timer when %s is emitted',
    async (cancelEvent) => {
      stop = setupRecoveryPostmortemAutomation({
        eventBus: events,
        db: { getProject },
        getPostmortem: () => ({ generatePostmortem }),
        delayMs: 5 * 60 * 1000,
      });

      await events.emit('recovery:success', {
        projectId: 'project-1',
        attempt: 1,
        durationMs: 1_000,
      });

      if (cancelEvent === 'deploy:failed') {
        await events.emit(cancelEvent, {
          projectId: 'project-1',
          step: 'run',
          error: 'deploy failed',
        });
      } else if (cancelEvent === 'recovery:failed') {
        await events.emit(cancelEvent, {
          projectId: 'project-1',
          attempt: 1,
          error: 'recovery failed',
        });
      } else {
        await events.emit(cancelEvent, {
          projectId: 'project-1',
          totalAttempts: 3,
          lastError: 'exhausted',
        });
      }

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(generatePostmortem).not.toHaveBeenCalled();
    },
  );

  it('restarts the timer when recovery succeeds again before the window expires', async () => {
    stop = setupRecoveryPostmortemAutomation({
      eventBus: events,
      db: { getProject },
      getPostmortem: () => ({ generatePostmortem }),
      delayMs: 5 * 60 * 1000,
    });

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 2,
      durationMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(generatePostmortem).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(generatePostmortem).toHaveBeenCalledTimes(1);
    expect(generatePostmortem).toHaveBeenCalledWith('project-1');
  });
});
