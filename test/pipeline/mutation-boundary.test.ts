/**
 * Pipeline boundary mutation policy tests.
 *
 * Verifies that `pipeline.redeploy` and `pipeline.rollback` enforce the
 * archived/recovering/circuit-breaker invariant via `assertProjectMutable`.
 * The previous test surface only checked the web router; this guards the
 * boundary so MCP / webhook / domain / compose callers cannot bypass it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { Database } from '../../src/db/index.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../../src/errors.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { clearPortScanCache } from '../../src/pipeline/port.js';

type EnvLike = {
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
  } as unknown as Docker;
}

describe('Pipeline mutation boundary policy', () => {
  let tmpDir: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-mutation-boundary-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function seedRunningProject(id: string, name: string) {
    db.createProject({ id, name, repoUrl: `https://github.com/test/${name}` });
    db.updateProject(id, {
      status: 'running',
      containerId: 'container-1',
      assignedPort: 10100,
    });
  }

  describe('pipeline.redeploy', () => {
    it('throws ProjectArchivedError when project is archived', async () => {
      seedRunningProject('p1', 'archived-app');
      db.archiveProject('p1');

      await expect(pipeline.redeploy('p1')).rejects.toBeInstanceOf(ProjectArchivedError);
    });

    it('throws ProjectRecoveringError when project is in recovering state', async () => {
      seedRunningProject('p1', 'recovering-app');
      db.updateProject('p1', { status: 'recovering' });

      await expect(pipeline.redeploy('p1')).rejects.toBeInstanceOf(ProjectRecoveringError);
    });

    it('throws CircuitBreakerOpenError when circuit breaker is open', async () => {
      seedRunningProject('p1', 'breaker-app');
      db.openCircuitBreaker('p1');

      await expect(pipeline.redeploy('p1')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    });

    it('does not acquire the deploy lock when policy rejects the call', async () => {
      seedRunningProject('p1', 'no-lock-app');
      db.archiveProject('p1');

      await expect(pipeline.redeploy('p1')).rejects.toBeInstanceOf(ProjectArchivedError);

      // No leftover lock — proves the throw happened before acquireDeployLock
      expect(db.getDeployLockInfo('p1')).toBeNull();
    });
  });

  describe('pipeline.rollback', () => {
    it('throws ProjectArchivedError when project is archived', async () => {
      seedRunningProject('p1', 'archived-rollback');
      db.archiveProject('p1');

      await expect(pipeline.rollback('p1')).rejects.toBeInstanceOf(ProjectArchivedError);
    });

    it('throws ProjectRecoveringError when project is recovering', async () => {
      seedRunningProject('p1', 'recovering-rollback');
      db.updateProject('p1', { status: 'recovering' });

      await expect(pipeline.rollback('p1')).rejects.toBeInstanceOf(ProjectRecoveringError);
    });

    it('throws CircuitBreakerOpenError when circuit breaker is open', async () => {
      seedRunningProject('p1', 'breaker-rollback');
      db.openCircuitBreaker('p1');

      await expect(pipeline.rollback('p1')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    });

    it('does not acquire the deploy lock when policy rejects the call', async () => {
      seedRunningProject('p1', 'no-lock-rollback');
      db.archiveProject('p1');

      await expect(pipeline.rollback('p1')).rejects.toBeInstanceOf(ProjectArchivedError);
      expect(db.getDeployLockInfo('p1')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // pipeline.deployEnvironment — webhook branch-target / env-specific deploy
  // path. Day 5 originally only covered redeploy + rollback; deployEnvironment
  // is the entry used by webhook push events and was bypassing the policy.
  // -------------------------------------------------------------------------
  describe('pipeline.deployEnvironment', () => {
    // Note: Database.createProject already auto-creates a `${id}-production`
    // environment, so we reuse it here instead of creating a second row.
    it('throws ProjectArchivedError when project is archived', async () => {
      seedRunningProject('p1', 'archived-env');
      db.archiveProject('p1');

      await expect(pipeline.deployEnvironment('p1', 'p1-production')).rejects.toBeInstanceOf(
        ProjectArchivedError,
      );
    });

    it('throws ProjectRecoveringError when project is recovering', async () => {
      seedRunningProject('p1', 'recovering-env');
      db.updateProject('p1', { status: 'recovering' });

      await expect(pipeline.deployEnvironment('p1', 'p1-production')).rejects.toBeInstanceOf(
        ProjectRecoveringError,
      );
    });

    it('throws CircuitBreakerOpenError when circuit breaker is open', async () => {
      seedRunningProject('p1', 'breaker-env');
      db.openCircuitBreaker('p1');

      await expect(pipeline.deployEnvironment('p1', 'p1-production')).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );
    });

    it('returns project-not-found result without consulting policy when project missing', async () => {
      const result = await pipeline.deployEnvironment('does-not-exist', 'env-x');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Project not found/);
    });
  });

  // -------------------------------------------------------------------------
  // pipeline.startDeploy — existing-project branch (chat / API / plan engine
  // / AI-approved fix flow re-entry). Without policy enforcement here, an
  // archived project could be silently re-deployed via these channels.
  // -------------------------------------------------------------------------
  describe('pipeline.startDeploy (existing-project branch)', () => {
    it('throws ProjectArchivedError when an archived project is re-targeted by name', async () => {
      seedRunningProject('p1', 'archived-redeploy');
      db.archiveProject('p1');

      await expect(
        pipeline.startDeploy({
          repoUrl: 'https://github.com/test/archived-redeploy',
          name: 'archived-redeploy',
        }),
      ).rejects.toBeInstanceOf(ProjectArchivedError);
    });

    it('throws ProjectRecoveringError when an existing recovering project is re-targeted', async () => {
      seedRunningProject('p1', 'recovering-redeploy');
      db.updateProject('p1', { status: 'recovering' });

      await expect(
        pipeline.startDeploy({
          repoUrl: 'https://github.com/test/recovering-redeploy',
          name: 'recovering-redeploy',
        }),
      ).rejects.toBeInstanceOf(ProjectRecoveringError);
    });

    it('throws CircuitBreakerOpenError when an existing project has an open circuit breaker', async () => {
      seedRunningProject('p1', 'breaker-redeploy');
      db.openCircuitBreaker('p1');

      await expect(
        pipeline.startDeploy({
          repoUrl: 'https://github.com/test/breaker-redeploy',
          name: 'breaker-redeploy',
        }),
      ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    });
  });
});
