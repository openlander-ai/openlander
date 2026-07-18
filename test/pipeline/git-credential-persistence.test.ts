import { describe, expect, it, vi } from 'vitest';

import type { DeployOrchestrationDeps } from '../../src/pipeline/deploy/orchestrator.js';
import { handlePostDeploy } from '../../src/pipeline/deploy/orchestrator.js';

describe('Deploy Key service persistence', () => {
  it('connects the selected credential only in the successful post-deploy path', async () => {
    const db = {
      saveDeployConfigForService: vi.fn(
        async (_serviceId: string, _json: string, _version: number) => undefined,
      ),
      updateService: vi.fn(async (_serviceId: string, _updates: Record<string, unknown>) => undefined),
    };
    const deps = { db } as unknown as DeployOrchestrationDeps;

    await handlePostDeploy(deps, {
      projectId: 'project_1',
      environmentId: 'project_1-production',
      config: {
        repoUrl: 'https://github.com/Team-SpaceY/incar-app',
        _serviceId: 'service_1',
        gitCredentialId: 'gitcred_1',
      },
      repoUrl: 'https://github.com/Team-SpaceY/incar-app',
      trigger: 'api',
      startTime: Date.now(),
      buildLog: '',
      shouldSyncProjectState: true,
      skipDeployLog: true,
      skipSuccessEvent: true,
      skipPhaseUpdate: true,
    });

    expect(db.updateService).toHaveBeenCalledWith('service_1', {
      gitCredentialId: 'gitcred_1',
    });
    const storedSnapshot = db.saveDeployConfigForService.mock.calls[0]?.[1];
    expect(storedSnapshot).not.toContain('gitCredentialId');
    expect(storedSnapshot).not.toContain('private_key');
  });
});
