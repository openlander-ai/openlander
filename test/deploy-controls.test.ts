import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { CloudflareTunnelManager } from '../src/pipeline/cloudflare.js';
import { CloudflareTunnel } from '../src/pipeline/tunnel.js';
import { ContainerNotFoundError, ProjectNotFoundError } from '../src/errors.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

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
    runContainer: vi.fn().mockResolvedValue('container-new-123456'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    inspectImage: vi.fn().mockResolvedValue({}),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
  } as unknown as Docker;
}

describe('DeployPipeline deploy controls', () => {
  let tmpDir: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-controls-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
  });

  afterEach(() => {
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('redeploy returns not found when project is missing', async () => {
    const result = await pipeline.redeploy('missing-project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Project not found: missing-project');
  });

  it('redeploy resets project state and reuses existing project id', async () => {
    db.createProject({
      id: 'p1',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.updateProject('p1', {
      status: 'running',
      containerId: 'container-old-1',
      imageTag: 'openlander/demo-app:v2',
      visibility: 'internal',
      assignedPort: 10010,
    });

    const deploySpy = vi.spyOn(pipeline, 'deploy').mockResolvedValue({
      success: true,
      projectId: 'p1',
      projectName: 'demo-app',
    });

    const result = await pipeline.redeploy('p1');

    expect(result.success).toBe(true);
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-old-1',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ol-demo-app');
    expect(deploySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _projectId: 'p1',
        name: 'demo-app',
      }),
    );

    const project = db.getProject('p1');
    expect(project?.status).toBe('building');
    expect(project?.container_id).toBeNull();
    expect(project?.image_tag).toBeNull();
    expect(project?.assigned_port).toBeNull();
    expect(project?.previous_image_tag).toBe('openlander/demo-app:v2');
  });

  it('rollback for environment returns error when previous image is unavailable', async () => {
    db.createProject({
      id: 'p2',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p2-development',
      projectId: 'p2',
      type: 'development',
      branch: 'develop',
    });

    const result = await pipeline.rollback('p2', 'p2-development');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No previous image available for rollback');
  });

  it('rollback for environment starts previous image and swaps image tags', async () => {
    db.createProject({
      id: 'p3',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p3-development',
      projectId: 'p3',
      type: 'development',
      branch: 'develop',
      status: 'running',
      assignedPort: 11011,
      containerId: 'container-development-old',
      imageTag: 'openlander/demo-app:development-new',
      previousImageTag: 'openlander/demo-app:development-old',
    });

    const result = await pipeline.rollback('p3', 'p3-development');

    expect(result.success).toBe(true);
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-development-old',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-development-old',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/demo-app:development-old',
        name: 'ol-demo-app',
        port: 11011,
      }),
    );

    const environment = db.getEnvironment('p3-development');
    expect(environment?.status).toBe('running');
    expect(environment?.image_tag).toBe('openlander/demo-app:development-old');
    expect(environment?.previous_image_tag).toBe('openlander/demo-app:development-new');
    expect(environment?.container_id).toBe('container-new-123456');
  });

  it('rollback marks project as error when restart with previous image fails', async () => {
    db.createProject({
      id: 'p4',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.updateProject('p4', {
      status: 'running',
      containerId: 'container-prod-old',
      imageTag: 'openlander/demo-app:v2',
      previousImageTag: 'openlander/demo-app:v1',
    });

    (docker.runContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const result = await pipeline.rollback('p4');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Rollback failed: boom');
    expect(db.getProject('p4')?.status).toBe('error');
  });

  it('stop environment handles missing container as non-fatal and marks environment stopped', async () => {
    db.createProject({
      id: 'p5',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p5-development',
      projectId: 'p5',
      type: 'development',
      branch: 'develop',
      status: 'running',
      containerId: 'container-missing',
    });

    (docker.stopContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ContainerNotFoundError('container-missing'),
    );

    await expect(pipeline.stop('p5', 'p5-development')).resolves.toBeUndefined();
    expect(db.getEnvironment('p5-development')?.status).toBe('stopped');
  });

  it('start project throws when container no longer exists and marks project error', async () => {
    db.createProject({
      id: 'p6',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.updateProject('p6', {
      status: 'stopped',
      containerId: 'container-missing',
    });

    (docker.startContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ContainerNotFoundError('container-missing'),
    );

    await expect(pipeline.start('p6')).rejects.toThrow(
      'Container for project demo-app no longer exists. Please redeploy.',
    );
    expect(db.getProject('p6')?.status).toBe('error');
  });

  it('remove recursively deletes child projects and domain routes', async () => {
    db.createProject({
      id: 'parent',
      name: 'mono',
      repoUrl: 'https://github.com/openlander/mono',
      branch: 'main',
    });
    db.updateProject('parent', { containerId: 'container-parent' });

    db.createProject({
      id: 'child',
      name: 'mono/api',
      repoUrl: 'https://github.com/openlander/mono',
      branch: 'main',
      parentProjectId: 'parent',
      dockerfilePath: 'api/Dockerfile',
    });
    db.updateProject('child', { containerId: 'container-child' });

    db.createDomainMapping({
      id: 'dm-1',
      projectId: 'parent',
      domain: 'mono.example.com',
    });

    const cloudflare = {
      removeTunnel: vi.fn().mockResolvedValue(undefined),
    } as unknown as CloudflareTunnelManager;

    await pipeline.remove('parent', cloudflare);

    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-child',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-parent',
    );
    expect(cloudflare.removeTunnel).toHaveBeenCalledWith('parent', 'mono.example.com');
    expect(db.getProject('child')).toBeUndefined();
    expect(db.getProject('parent')).toBeUndefined();
  });

  it('deployPreview reuses existing preview project and returns URL on redeploy success', async () => {
    db.createProject({
      id: 'parent-1',
      name: 'parent-preview-1',
      repoUrl: 'https://github.com/openlander/parent-preview-1',
      branch: 'main',
    });
    db.createProject({
      id: 'p7',
      name: 'preview-app',
      repoUrl: 'https://github.com/openlander/preview-app',
      branch: 'main',
    });

    vi.spyOn(pipeline, 'redeploy').mockResolvedValue({
      success: true,
      projectId: 'p7',
      projectName: 'preview-app',
    });

    const result = await pipeline.deployPreview({
      parentProjectId: 'parent-1',
      previewName: 'preview-app',
      repoUrl: 'https://github.com/openlander/preview-app',
      branch: 'feature/pr-1',
      prNumber: 1,
      commitSha: 'abc123',
    });

    expect(result.success).toBe(true);
    expect(result.url).toContain('preview-app.');
    expect(db.getProject('p7')?.is_preview).toBe(1);
    expect(db.getProject('p7')?.parent_project_id).toBe('parent-1');
  });

  it('deployPreview returns error when existing preview redeploy fails', async () => {
    db.createProject({
      id: 'parent-2',
      name: 'parent-preview-2',
      repoUrl: 'https://github.com/openlander/parent-preview-2',
      branch: 'main',
    });
    db.createProject({
      id: 'p8',
      name: 'preview-fail-app',
      repoUrl: 'https://github.com/openlander/preview-fail-app',
      branch: 'main',
    });

    vi.spyOn(pipeline, 'redeploy').mockResolvedValue({
      success: false,
      projectId: 'p8',
      projectName: 'preview-fail-app',
      error: 'redeploy failed',
    });

    const result = await pipeline.deployPreview({
      parentProjectId: 'parent-2',
      previewName: 'preview-fail-app',
      repoUrl: 'https://github.com/openlander/preview-fail-app',
      branch: 'feature/pr-2',
      prNumber: 2,
      commitSha: 'def456',
    });

    expect(result).toEqual({ success: false, error: 'redeploy failed' });
  });

  it('deployPreview returns error when fresh deploy fails', async () => {
    vi.spyOn(pipeline, 'deploy').mockResolvedValue({
      success: false,
      projectId: 'p9',
      projectName: 'preview-new-fail',
      error: 'deploy failed',
    });

    const result = await pipeline.deployPreview({
      parentProjectId: 'parent-3',
      previewName: 'preview-new-fail',
      repoUrl: 'https://github.com/openlander/preview-new-fail',
      branch: 'feature/pr-3',
      prNumber: 3,
      commitSha: 'ghi789',
    });

    expect(result).toEqual({ success: false, error: 'deploy failed' });
  });

  it('deployPreview catches thrown errors and returns failure payload', async () => {
    vi.spyOn(db, 'getProjectByName').mockImplementationOnce(() => {
      throw new Error('db read failed');
    });

    const result = await pipeline.deployPreview({
      parentProjectId: 'parent-4',
      previewName: 'preview-crash',
      repoUrl: 'https://github.com/openlander/preview-crash',
      branch: 'feature/pr-4',
      prNumber: 4,
      commitSha: 'jkl012',
    });

    expect(result).toEqual({ success: false, error: 'db read failed' });
  });

  it('start environment handles missing container as non-fatal and marks environment running', async () => {
    db.createProject({
      id: 'p10',
      name: 'start-env-app',
      repoUrl: 'https://github.com/openlander/start-env-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p10-development',
      projectId: 'p10',
      type: 'development',
      branch: 'develop',
      status: 'stopped',
      containerId: 'container-missing-env',
    });

    (docker.startContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ContainerNotFoundError('container-missing-env'),
    );

    await expect(pipeline.start('p10', 'p10-development')).resolves.toBeUndefined();
    expect(db.getEnvironment('p10-development')?.status).toBe('running');
  });

  it('stop/start on parent project traverses children and updates parent status', async () => {
    db.createProject({
      id: 'parent-ops',
      name: 'mono-ops',
      repoUrl: 'https://github.com/openlander/mono-ops',
      branch: 'main',
    });
    db.createProject({
      id: 'child-ops',
      name: 'mono-ops/api',
      repoUrl: 'https://github.com/openlander/mono-ops',
      branch: 'main',
      parentProjectId: 'parent-ops',
      dockerfilePath: 'api/Dockerfile',
    });
    db.updateProject('child-ops', {
      status: 'running',
      containerId: 'child-container',
    });

    await pipeline.stop('parent-ops');
    expect(db.getProject('parent-ops')?.status).toBe('stopped');
    expect(db.getProject('child-ops')?.status).toBe('stopped');
    // After destructive stop, container_id is cleared — start() requires redeploy
    expect(db.getProject('child-ops')?.container_id).toBeNull();
  });

  it('getLogs returns friendly message when project has no container', async () => {
    db.createProject({
      id: 'p11',
      name: 'logs-empty-app',
      repoUrl: 'https://github.com/openlander/logs-empty-app',
      branch: 'main',
    });

    const logs = await pipeline.getLogs('p11');

    expect(logs).toBe('No container running for this project.');
  });

  it('getLogs fetches logs when container id exists', async () => {
    db.createProject({
      id: 'p12',
      name: 'logs-live-app',
      repoUrl: 'https://github.com/openlander/logs-live-app',
      branch: 'main',
    });
    db.updateProject('p12', { containerId: 'container-live' });
    (docker.getLogs as ReturnType<typeof vi.fn>).mockResolvedValueOnce('line-a\nline-b');

    const logs = await pipeline.getLogs('p12', 20);

    expect(docker.getLogs as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-live', 20);
    expect(logs).toBe('line-a\nline-b');
  });

  it('rollback throws ProjectNotFoundError when project does not exist', async () => {
    await expect(pipeline.rollback('missing-project')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('rollback for project returns error when previous image is unavailable', async () => {
    db.createProject({
      id: 'p13',
      name: 'no-prev-image-app',
      repoUrl: 'https://github.com/openlander/no-prev-image-app',
      branch: 'main',
    });

    const result = await pipeline.rollback('p13');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No previous image available for rollback');
  });

  it('rollback for environment returns error when environment does not exist', async () => {
    db.createProject({
      id: 'p14',
      name: 'missing-env-rollback',
      repoUrl: 'https://github.com/openlander/missing-env-rollback',
      branch: 'main',
    });

    const result = await pipeline.rollback('p14', 'missing-env');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Environment not found: missing-env');
  });

  it('stop/start for missing environment container return early without side effects', async () => {
    db.createProject({
      id: 'p15',
      name: 'no-container-env-app',
      repoUrl: 'https://github.com/openlander/no-container-env-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p15-development',
      projectId: 'p15',
      type: 'development',
      branch: 'develop',
    });

    await expect(pipeline.stop('p15', 'p15-development')).resolves.toBeUndefined();
    await expect(pipeline.start('p15', 'p15-development')).resolves.toBeUndefined();

    expect(docker.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(undefined);
    expect(docker.startContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(undefined);
  });

  it('stop/start for project with no container return early', async () => {
    db.createProject({
      id: 'p16',
      name: 'no-container-project',
      repoUrl: 'https://github.com/openlander/no-container-project',
      branch: 'main',
    });

    await expect(pipeline.stop('p16')).resolves.toBeUndefined();
    await expect(pipeline.start('p16')).resolves.toBeUndefined();

    expect(db.getProject('p16')?.status).toBe('stopped');
  });

  it('remove returns quietly when project does not exist', async () => {
    await expect(pipeline.remove('missing-remove')).resolves.toBeUndefined();
  });

  it('remove tolerates cloudflare cleanup failures and still deletes project', async () => {
    db.createProject({
      id: 'p18',
      name: 'cloudflare-cleanup-app',
      repoUrl: 'https://github.com/openlander/cloudflare-cleanup-app',
      branch: 'main',
    });
    db.createDomainMapping({
      id: 'dm-2',
      projectId: 'p18',
      domain: 'cleanup.example.com',
    });

    const cloudflare = {
      removeTunnel: vi.fn().mockRejectedValue(new Error('remove failed')),
    } as unknown as CloudflareTunnelManager;

    await expect(pipeline.remove('p18', cloudflare)).resolves.toBeUndefined();

    expect(cloudflare.removeTunnel).toHaveBeenCalledWith('p18', 'cleanup.example.com');
    expect(db.getProject('p18')).toBeUndefined();
  });

  it('exposeTunnel stores active tunnel and updates project public URL', async () => {
    db.createProject({
      id: 'p19',
      name: 'public-tunnel-app',
      repoUrl: 'https://github.com/openlander/public-tunnel-app',
      branch: 'main',
    });

    const startSpy = vi
      .spyOn(CloudflareTunnel.prototype, 'start')
      .mockResolvedValueOnce('https://public-tunnel.example.trycloudflare.com');

    const url = await pipeline.exposeTunnel('p19', 12000);

    expect(url).toBe('https://public-tunnel.example.trycloudflare.com');
    expect(startSpy).toHaveBeenCalledWith('public-tunnel-app');
    expect(pipeline.getTunnel('p19')).toBeDefined();
    expect(db.getProject('p19')?.visibility).toBe('quick-share');
    expect(db.getProject('p19')?.public_url).toBe(
      'https://public-tunnel.example.trycloudflare.com',
    );
  });

  it('closeTunnel does nothing when tunnel is absent', () => {
    db.createProject({
      id: 'p17-no-tunnel',
      name: 'no-tunnel-app',
      repoUrl: 'https://github.com/openlander/no-tunnel-app',
      branch: 'main',
    });

    pipeline.closeTunnel('p17-no-tunnel');

    expect(db.getProject('p17-no-tunnel')?.visibility).toBe('internal');
  });

  it('getTunnel returns active tunnel reference when present', () => {
    const tunnel = { stop: vi.fn() };
    (
      pipeline as unknown as {
        tunnelManager: { tunnels: Map<string, unknown> };
      }
    ).tunnelManager.tunnels.set('p18', tunnel);

    expect(pipeline.getTunnel('p18')).toBe(tunnel);
    expect(pipeline.getTunnel('missing')).toBeUndefined();
  });
});
