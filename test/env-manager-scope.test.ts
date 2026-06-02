import { describe, expect, it, vi } from 'vitest';

import { EnvManager } from '../src/pipeline/env.js';

function createEnvManager() {
  const db = {
    getEnvVars: vi.fn().mockResolvedValue({}),
    getEnvVarsForService: vi.fn().mockResolvedValue({}),
    mergeEnvVarsDetailed: vi.fn().mockResolvedValue([{ key: 'A', op: 'insert' }]),
    mergeEnvVarsForServiceDetailed: vi.fn().mockResolvedValue([{ key: 'A', op: 'insert' }]),
    deleteEnvVar: vi.fn().mockResolvedValue(undefined),
    deleteEnvVarForService: vi.fn().mockResolvedValue(undefined),
    getEnvironmentsByProject: vi.fn().mockResolvedValue([]),
    getGlobalSecrets: vi.fn().mockResolvedValue([]),
  };
  const env = new EnvManager(db as unknown as ConstructorParameters<typeof EnvManager>[0]);
  return { db, env };
}

describe('EnvManager scope forwarding', () => {
  it('preserves project environment scope for set/get/delete wrappers', async () => {
    const { db, env } = createEnvManager();
    db.getEnvVars.mockResolvedValueOnce({}).mockResolvedValueOnce({ A: '1' });

    await env.setBulk('p1', { A: '1' }, 'env-development');
    await env.getAll('p1', 'env-development');
    await env.delete('p1', 'A', 'env-development');

    expect(db.mergeEnvVarsDetailed).toHaveBeenCalledWith('p1', { A: '1' }, 'env-development');
    expect(db.getEnvVars).toHaveBeenCalledWith('p1', 'env-development');
    expect(db.deleteEnvVar).toHaveBeenCalledWith('p1', 'A', 'env-development');
  });

  it('preserves service environment scope for set/get/delete wrappers', async () => {
    const { db, env } = createEnvManager();
    db.getEnvVarsForService.mockResolvedValueOnce({}).mockResolvedValueOnce({ A: '1' });

    await env.setBulkForService('p1', 'svc1', { A: '1' }, 'env-development');
    await env.getAllForService('p1', 'svc1', 'env-development');
    await env.deleteForService('p1', 'svc1', 'A', 'env-development');

    expect(db.mergeEnvVarsForServiceDetailed).toHaveBeenCalledWith(
      'p1',
      'svc1',
      { A: '1' },
      'env-development',
    );
    expect(db.getEnvVarsForService).toHaveBeenCalledWith('p1', 'svc1', 'env-development');
    expect(db.deleteEnvVarForService).toHaveBeenCalledWith('p1', 'svc1', 'A', 'env-development');
  });

  it('keeps existing service-scoped MCP path on shared service vars when no environment is passed', async () => {
    const { db, env } = createEnvManager();

    await env.setBulkForService('p1', 'svc1', { A: '1' });
    await env.verifyRoundTripForService('p1', 'svc1', { A: '1' });

    expect(db.mergeEnvVarsForServiceDetailed).toHaveBeenCalledWith(
      'p1',
      'svc1',
      { A: '1' },
      undefined,
    );
    expect(db.getEnvVarsForService).toHaveBeenCalledWith('p1', 'svc1', undefined);
  });
});
