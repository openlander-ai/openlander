import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/db/index.js';
import type { DeployOrchestrationDeps } from '../../../src/pipeline/deploy/orchestrator.js';

const gitMocks = vi.hoisted(() => ({
  cloneRepo: vi.fn(),
  getCommitSubject: vi.fn(),
  redactRepoUrl: vi.fn((repoUrl: string) => repoUrl),
}));

vi.mock('../../../src/pipeline/git.js', () => gitMocks);

const { cloneAndAnalyze } = await import('../../../src/pipeline/deploy/orchestrator.js');

describe('cloneAndAnalyze source revision detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gitMocks.cloneRepo.mockResolvedValue({
      path: '/tmp/repo',
      commitSha: 'same-commit',
    });
    gitMocks.getCommitSubject.mockResolvedValue('same commit');
  });

  it('falls back to the latest project deploy when a legacy Compose log has no environment id', async () => {
    const getLastDeployLog = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: 'success', commit_sha: 'same-commit' });
    const deps = {
      db: { getLastDeployLog } as unknown as Database,
      env: { getAll: vi.fn().mockResolvedValue({}) },
      applyPendingFix: vi.fn().mockResolvedValue(null),
      secretScanEnabled: false,
    } as unknown as DeployOrchestrationDeps;

    const result = await cloneAndAnalyze(deps, {
      projectId: 'project-1',
      projectName: 'stack',
      environmentId: 'project-1-production',
      repoUrl: 'https://github.com/example/stack.git',
    });

    expect(result.sourceRevisionChanged).toBe(false);
    expect(getLastDeployLog).toHaveBeenNthCalledWith(1, 'project-1', 'project-1-production');
    expect(getLastDeployLog).toHaveBeenNthCalledWith(2, 'project-1');
  });
});
