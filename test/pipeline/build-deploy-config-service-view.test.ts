import { describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import { buildDeployConfig } from '../../src/pipeline/build-deploy-config.js';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p1',
    name: 'demo-app',
    status: 'running',
    visibility: 'internal',
    source: 'git',
    build_method: 'compose',
    image_url: 'stale-project-image',
    image_cmd: '["stale-project-cmd"]',
    container_port: 3000,
    dockerfile_path: 'stale/Dockerfile',
    docker_target: 'stale-target',
    build_context: 'stale-context',
    assigned_port: 1111,
    ...overrides,
  } as ProjectRow;
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p1__svc',
    project_id: 'p1',
    name: 'demo-app__svc',
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/example/service.git',
    branch: 'service-branch',
    status: 'running',
    build_method: 'dockerfile',
    image_url: 'canonical-service-image',
    image_cmd: '["node","server.js"]',
    container_port: 8080,
    dockerfile_path: 'service/Dockerfile',
    docker_target: 'service-target',
    build_context: 'service',
    assigned_port: 4567,
    ...overrides,
  } as ServiceRow;
}

describe('buildDeployConfig ServiceView projection', () => {
  it('uses canonical service build/runtime config before stale project columns', async () => {
    const project = makeProject();
    const service = makeService();
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => service),
      loadDeployConfigForService: vi.fn(async () => null),
      loadDeployConfig: vi.fn(async () => null),
    } as unknown as Database;

    const config = await buildDeployConfig({ projectId: 'p1', db });

    expect(config).toMatchObject({
      repoUrl: 'https://github.com/example/service.git',
      branch: 'service-branch',
      source: 'git',
      imageUrl: 'canonical-service-image',
      imageCmd: ['node', 'server.js'],
      containerPort: 8080,
      dockerfilePath: 'service/Dockerfile',
      dockerTarget: 'service-target',
      buildContext: 'service',
      preferDockerfile: true,
      _projectId: 'p1',
      _serviceId: 'p1__svc',
      _preferredPort: 4567,
    });
    expect(db.loadDeployConfigForService).toHaveBeenCalledWith('p1__svc');
    expect(db.loadDeployConfig).not.toHaveBeenCalled();
  });
});
