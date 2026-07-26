import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { ReleaseService } from '../../src/release/release-service.js';

const digest = `sha256:${'d'.repeat(64)}`;

async function createHarness(clonedCommit = 'a'.repeat(40)) {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'openlander-release-test-'));
  await mkdir(join(repositoryPath, 'app'), { recursive: true });
  const run = {
    id: 'run-1',
    delivery_id: 'delivery-1',
    status: 'running',
    current_phase: 'quality_gates_passed',
    commit_sha: 'a'.repeat(40),
    manifest_sha256: 'b'.repeat(64),
  };
  const delivery = { id: run.delivery_id, project_id: 'project-1' };
  let release = {
    id: 'release-1',
    delivery_id: delivery.id,
    agent_run_id: run.id,
    version: '2026.07.26',
    commit_sha: run.commit_sha,
    status: 'building',
  };
  const artifact = {
    id: 'artifact-1',
    release_id: release.id,
    service_id: 'service-1',
    image_reference: digest,
    image_digest: digest,
  };
  const db = {
    requireDeliveryAgentRun: vi.fn(async () => run),
    requireDelivery: vi.fn(async () => delivery),
    listDeliveryGates: vi.fn(async () => [
      { gate_key: 'qa', source: 'manifest', required: true, status: 'passed' },
    ]),
    createRelease: vi.fn(async () => release),
    getDeployablesByGroup: vi.fn(async () => [
      {
        id: 'service-1',
        kind: 'git',
        source: 'git',
        repo_url: 'https://github.com/example/project.git',
        branch: 'main',
        git_credential_id: null,
        build_context: 'app',
        dockerfile_path: 'Dockerfile',
        docker_target: null,
      },
    ]),
    addReleaseArtifact: vi.fn(async () => artifact),
    setReleaseStatus: vi.fn(async (_id: string, status: typeof release.status) => {
      release = { ...release, status };
      return release;
    }),
    requireRelease: vi.fn(async () => release),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const docker = {
    buildImage: vi.fn(async () => undefined),
    inspectImage: vi.fn(async () => ({ Id: digest })),
  };
  const cloneRepository = vi.fn(async () => ({
    path: repositoryPath,
    commitSha: clonedCommit,
    branch: 'main',
  }));
  const service = new ReleaseService(
    db as unknown as Database,
    docker as unknown as Docker,
    cloneRepository,
  );
  return { service, db, docker, run, release };
}

describe('ReleaseService', () => {
  it('adopts a successful deploy_app image as an immutable Release without rebuilding', async () => {
    const deployId = 'deploy-compat-1';
    const project = { id: 'project-1' };
    const deployedService = {
      id: 'service-1',
      project_id: project.id,
      kind: 'git',
      image_tag: 'openlander/example:mutable',
    };
    const deployLog = {
      id: deployId,
      service_id: deployedService.id,
      status: 'success',
      commit_sha: 'a'.repeat(40),
    };
    const delivery = { id: 'delivery-created', project_id: project.id };
    const run = { id: 'run-created', delivery_id: delivery.id, status: 'running' };
    const buildingRelease = {
      id: 'release-created',
      delivery_id: delivery.id,
      agent_run_id: run.id,
      version: `deploy-${deployId}`,
      commit_sha: deployLog.commit_sha,
      status: 'building',
    };
    const db = {
      getProject: vi.fn(async () => project),
      getService: vi.fn(async () => deployedService),
      getDeployablesByGroup: vi.fn(async () => [deployedService]),
      getComposeChildren: vi.fn(async () => []),
      getDeployLog: vi.fn(async () => deployLog),
      getLastDeployLogForService: vi.fn(async () => deployLog),
      createDelivery: vi.fn(async () => delivery),
      startDeliveryAgentRun: vi.fn(async () => run),
      createRelease: vi.fn(async () => buildingRelease),
      addReleaseArtifact: vi.fn(async (input) => ({
        id: 'artifact-1',
        release_id: input.releaseId,
        service_id: input.serviceId,
        image_reference: input.imageReference,
        image_digest: input.imageDigest,
      })),
      setReleaseStatus: vi.fn(async () => ({ ...buildingRelease, status: 'ready' })),
      linkDeliveryDeploy: vi.fn(async () => undefined),
      completeDeliveryAgentRun: vi.fn(async () => ({ ...run, status: 'completed' })),
      insertActivityLog: vi.fn(async () => undefined),
    };
    const docker = {
      buildImage: vi.fn(async () => undefined),
      inspectImage: vi.fn(async () => ({ Id: digest })),
    };
    const service = new ReleaseService(db as unknown as Database, docker as unknown as Docker);

    const result = await service.adoptSuccessfulDeploy({
      projectId: project.id,
      serviceId: deployedService.id,
      deployId,
      actor: 'external-agent',
    });

    expect(docker.buildImage).not.toHaveBeenCalled();
    expect(db.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ autoFinalize: false, gates: [] }),
    );
    expect(db.addReleaseArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        imageReference: digest,
        imageDigest: digest,
        buildProvenance: expect.objectContaining({
          source: 'deploy_app_compatibility',
          rebuilt: false,
          deployed_image_reference: deployedService.image_tag,
        }),
      }),
    );
    expect(db.linkDeliveryDeploy).toHaveBeenCalledWith({
      deliveryId: delivery.id,
      deployId,
      relation: 'released',
    });
    expect(result.release.status).toBe('ready');
  });

  it('builds once and stores the immutable image digest with provenance', async () => {
    const harness = await createHarness();
    const result = await harness.service.create({
      id: 'release-1',
      runId: harness.run.id,
      version: '2026.07.26',
      actor: 'agent-a',
    });

    expect(harness.docker.buildImage).toHaveBeenCalledTimes(1);
    expect(harness.db.addReleaseArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        imageReference: digest,
        imageDigest: digest,
        buildProvenance: expect.objectContaining({
          commit_sha: harness.run.commit_sha,
          manifest_sha256: harness.run.manifest_sha256,
        }),
      }),
    );
    expect(result.release.status).toBe('ready');
  });

  it('normalizes uppercase ULID Release ids into valid lowercase Docker repository names', async () => {
    const harness = await createHarness();
    harness.release.id = 'rel_01KYFE209RPJFFYYK41AW76V0D';

    await harness.service.create({
      id: harness.release.id,
      runId: harness.run.id,
      version: '2026.07.26-RC.4',
      actor: 'agent-a',
    });

    expect(harness.docker.buildImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^openlander\/release-[a-z0-9_.-]+-[a-z0-9_.-]+:2026\.07\.26-rc\.4$/),
      expect.any(Object),
    );
  });

  it('fails without building when the cloned commit differs from the passed Run', async () => {
    const harness = await createHarness('c'.repeat(40));

    await expect(
      harness.service.create({
        id: 'release-1',
        runId: harness.run.id,
        version: '2026.07.26',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_STATE_INVALID' });
    expect(harness.docker.buildImage).not.toHaveBeenCalled();
    expect(harness.db.setReleaseStatus).toHaveBeenCalledWith('release-1', 'failed');
  });

  it('builds one immutable artifact per service from the same repository commit', async () => {
    const harness = await createHarness();
    harness.db.getDeployablesByGroup.mockResolvedValue([
      {
        id: 'service-1',
        kind: 'git',
        source: 'git',
        repo_url: 'https://github.com/example/project.git',
        branch: 'main',
        git_credential_id: null,
        build_context: 'app',
        dockerfile_path: 'Dockerfile',
        docker_target: null,
      },
      {
        id: 'service-2',
        kind: 'git',
        source: 'git',
        repo_url: 'https://github.com/example/project.git',
        branch: 'main',
        git_credential_id: null,
        build_context: 'worker',
        dockerfile_path: 'Dockerfile',
        docker_target: null,
      },
    ]);
    harness.db.addReleaseArtifact.mockImplementation(async (input) => ({
      id: `artifact-${input.serviceId}`,
      release_id: input.releaseId,
      service_id: input.serviceId,
      image_reference: input.imageReference,
      image_digest: input.imageDigest,
    }));

    const result = await harness.service.create({
      id: 'release-1',
      runId: harness.run.id,
      version: '2026.07.26',
      actor: 'agent-a',
    });

    expect(harness.docker.buildImage).toHaveBeenCalledTimes(2);
    expect(harness.db.addReleaseArtifact).toHaveBeenCalledTimes(2);
    expect(result.artifacts.map((entry) => entry.service_id)).toEqual(['service-1', 'service-2']);
  });

  it('fails closed when one Agent Run would span unrelated repositories', async () => {
    const harness = await createHarness();
    const first = (await harness.db.getDeployablesByGroup())[0];
    harness.db.getDeployablesByGroup.mockResolvedValue([
      first,
      { ...first, id: 'service-2', repo_url: 'https://github.com/example/other.git' },
    ]);

    await expect(
      harness.service.create({
        id: 'release-1',
        runId: harness.run.id,
        version: '2026.07.26',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_STATE_INVALID' });
    expect(harness.docker.buildImage).not.toHaveBeenCalled();
  });

  it('marks the durable Release failed when background validation rejects the Run', async () => {
    const harness = await createHarness();
    harness.run.current_phase = 'implementation';

    await harness.service.start({
      id: 'release-1',
      runId: harness.run.id,
      version: '2026.07.26',
      actor: 'agent-a',
    });

    await vi.waitFor(() => {
      expect(harness.db.setReleaseStatus).toHaveBeenCalledWith('release-1', 'failed');
    });
    expect(harness.docker.buildImage).not.toHaveBeenCalled();
  });
});
