import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { DeliveryService } from '../../src/delivery/delivery-service.js';
import type { DeliveryAgentRunService } from '../../src/delivery/agent-run-service.js';
import { deliveryManifestSha256 } from '../../src/delivery/manifest.js';
import { DeliveryQualityGateService } from '../../src/delivery/quality-gate-service.js';
import type { Docker } from '../../src/pipeline/docker.js';

const tempDirectories: string[] = [];

async function createHarness(exitCode = 0) {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'openlander-quality-test-'));
  tempDirectories.push(repositoryPath);
  await mkdir(join(repositoryPath, '.openlander'), { recursive: true });
  await mkdir(join(repositoryPath, 'reports'), { recursive: true });
  const manifest = `
version: 1
runner:
  image: node:22
  timeout_seconds: 60
checks:
  - key: unit
    gate: qa
    command: [npm, test, --, --run]
    report:
      path: reports/junit.xml
      format: junit
`;
  await writeFile(join(repositoryPath, '.openlander/delivery.yml'), manifest);
  await writeFile(
    join(repositoryPath, 'reports/junit.xml'),
    '<testsuite tests="1" failures="0"></testsuite>',
  );
  const run = {
    id: 'run-quality',
    delivery_id: 'delivery-quality',
    status: 'running',
    commit_sha: 'a'.repeat(40),
    manifest_path: '.openlander/delivery.yml',
    manifest_sha256: deliveryManifestSha256(Buffer.from(manifest)),
    runner_image: 'node:22',
    runner_image_digest: null as string | null,
  };
  const delivery = { id: run.delivery_id, project_id: 'project-quality' };
  const checks: Array<Record<string, unknown>> = [];
  const db = {
    requireDeliveryAgentRun: vi.fn(async () => run),
    requireDelivery: vi.fn(async () => delivery),
    getDeployablesByGroup: vi.fn(async () => [
      {
        id: 'service-quality',
        source: 'git',
        repo_url: 'https://github.com/example/project.git',
        branch: 'main',
        git_credential_id: null,
      },
    ]),
    listDeliveryGates: vi.fn(async () => [
      { id: 'gate-qa', gate_key: 'qa', source: 'manifest' },
      { id: 'gate-review', gate_key: 'customer-review', source: 'manifest' },
    ]),
    setDeliveryAgentRunRunnerDigest: vi.fn(async (_id: string, digest: string) => {
      run.runner_image_digest = digest;
      return run;
    }),
    startDeliveryRunCheck: vi.fn(async (input: Record<string, unknown>) => {
      const check = {
        id: 'check-unit-1',
        run_id: run.id,
        check_key: input['checkKey'],
        attempt: 1,
        status: 'running',
        report_artifact_id: null,
      };
      checks.push(check);
      return check;
    }),
    finishDeliveryRunCheck: vi.fn(async (input: Record<string, unknown>) => {
      const check = checks[0];
      Object.assign(check ?? {}, {
        status: input['status'],
        log_sha256: input['logSha256'],
        report_artifact_id: input['reportArtifactId'],
      });
      return check;
    }),
    listDeliveryRunChecks: vi.fn(async () => checks),
  };
  const deliveryService = {
    assertDeliveryCanMutate: vi.fn(async () => undefined),
    uploadArtifact: vi.fn(async () => ({ id: 'artifact-junit' })),
    recordGateResult: vi.fn(async (input: Record<string, unknown>) => input),
  };
  const agentRunService = {
    fail: vi.fn(async () => {
      run.status = 'failed';
      return run;
    }),
    recordProgress: vi.fn(async () => ({ run, event: { id: 'event-quality' } })),
  };
  const digest = `sha256:${'d'.repeat(64)}`;
  const docker = {
    pullImage: vi.fn(async () => undefined),
    inspectImage: vi.fn(async () => ({
      Id: digest,
      RepoDigests: [`node@${digest}`],
    })),
    runEphemeralContainer: vi.fn(async () => ({
      exitCode,
      durationMs: 321,
      logs: 'API_KEY=super-secret test output',
      timedOut: false,
    })),
  };
  const cloneRepository = vi.fn(async () => ({
    path: repositoryPath,
    commitSha: 'a'.repeat(40),
    branch: 'main',
  }));
  const service = new DeliveryQualityGateService(
    db as unknown as Database,
    deliveryService as unknown as DeliveryService,
    agentRunService as unknown as DeliveryAgentRunService,
    docker as unknown as Docker,
    cloneRepository,
  );
  return { service, db, deliveryService, agentRunService, docker, run, digest };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('DeliveryQualityGateService', () => {
  it('verifies the snapshot and records a passing check, report, digest, and Gate', async () => {
    const harness = await createHarness();
    const result = await harness.service.execute({ runId: harness.run.id, actor: 'agent-a' });

    expect(result).toMatchObject({
      status: 'passed',
      failed_checks: [],
      checks: [
        {
          check_key: 'unit',
          status: 'passed',
          exit_code: 0,
          report_artifact_id: 'artifact-junit',
        },
      ],
    });
    expect(harness.docker.runEphemeralContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: `node@${harness.digest}`,
        command: ['npm', 'test', '--', '--run'],
      }),
    );
    expect(harness.db.finishDeliveryRunCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'passed',
        logSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(harness.deliveryService.recordGateResult).toHaveBeenCalledWith(
      expect.objectContaining({ gateKey: 'qa', status: 'passed' }),
    );
    expect(harness.deliveryService.recordGateResult).not.toHaveBeenCalledWith(
      expect.objectContaining({ gateKey: 'customer-review' }),
    );
    expect(harness.agentRunService.recordProgress).toHaveBeenCalled();
    expect(harness.agentRunService.fail).not.toHaveBeenCalled();
  });

  it('marks the check, Gate, and Agent Run failed when the command exits non-zero', async () => {
    const harness = await createHarness(1);
    const result = await harness.service.execute({ runId: harness.run.id, actor: 'agent-a' });

    expect(result).toMatchObject({ status: 'failed', failed_checks: ['unit'] });
    expect(harness.deliveryService.recordGateResult).toHaveBeenCalledWith(
      expect.objectContaining({ gateKey: 'qa', status: 'failed' }),
    );
    expect(harness.agentRunService.fail).toHaveBeenCalledWith(
      expect.objectContaining({ runId: harness.run.id }),
    );
  });

  it('fails before Docker execution when the cloned commit differs', async () => {
    const harness = await createHarness();
    harness.run.commit_sha = 'b'.repeat(40);

    await expect(
      harness.service.execute({ runId: harness.run.id, actor: 'agent-a' }),
    ).rejects.toMatchObject({ code: 'DELIVERY_MANIFEST_MISMATCH' });
    expect(harness.docker.runEphemeralContainer).not.toHaveBeenCalled();
    expect(harness.agentRunService.fail).toHaveBeenCalled();
  });
});
