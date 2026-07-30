import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/db/index.js';
import type { ProjectRow, ServiceRow } from '../../../src/db/types.js';
import { ContainerLifecycle } from '../../../src/pipeline/deploy/lifecycle.js';
import type { RuntimeBackend } from '../../../src/pipeline/runtime/index.js';

const MARKER = '2026-07-30T00:00:00.000Z';

function project(id: string, name: string, archivedAt: string | null): ProjectRow {
  return {
    id,
    name,
    archived_at: archivedAt,
    status: archivedAt ? 'stopped' : 'running',
  } as ProjectRow;
}

function service(
  id: string,
  overrides: Partial<ServiceRow> = {},
): ServiceRow {
  return {
    id,
    project_id: 'parent',
    name: id,
    kind: 'compose-child',
    parent_service_id: 'parent__svc',
    runtime_role: 'resource',
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: null,
    container_name: null,
    container_port: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'git',
    repo_url: null,
    branch: null,
    image_url: null,
    image_cmd: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    archived_at: null,
    server_id: 'local',
    created_at: MARKER,
    updated_at: MARKER,
    ...overrides,
  } as ServiceRow;
}

describe('Stateful Compose archive lifecycle', () => {
  it('retains a resource container and records one restore-set marker', async () => {
    const childProject = project('db-child', 'demo/db', null);
    const childService = service('db-child__svc', {
      container_id: 'db-container-1234567890',
      container_name: 'ol-demo-db',
      image_tag: 'postgres:17-alpine',
    });
    const archiveProject = vi.fn(async () => undefined);
    const db = {
      getProject: vi.fn(async () => childProject),
      getDeployableForProject: vi.fn(async () => childService),
      getComposeChildProjects: vi.fn(async () => []),
      archiveProject,
    } as unknown as Database;
    const runtime = {
      stopContainer: vi.fn(async () => undefined),
      disconnectContainerFromNetwork: vi.fn(async () => undefined),
      renameContainer: vi.fn(async () => undefined),
      startContainer: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      removeImage: vi.fn(async () => undefined),
    } as unknown as RuntimeBackend;
    const lifecycle = new ContainerLifecycle(runtime, db);

    await lifecycle.archive('db-child');

    expect(runtime.stopContainer).toHaveBeenCalledWith('db-container-1234567890');
    expect(runtime.disconnectContainerFromNetwork).toHaveBeenCalledWith(
      'db-container-1234567890',
      'ol-demo',
    );
    expect(runtime.renameContainer).toHaveBeenCalledWith(
      'db-container-1234567890',
      'ol-demo-db-archived-db-container',
    );
    expect(runtime.removeContainer).not.toHaveBeenCalled();
    expect(runtime.removeImage).not.toHaveBeenCalled();
    expect(archiveProject).toHaveBeenCalledWith(
      'db-child',
      undefined,
      {
        containerId: 'db-container-1234567890',
        containerName: 'ol-demo-db-archived-db-container',
        imageTag: 'postgres:17-alpine',
      },
    );
  });

  it('restores matching children before clearing the Compose parent archive', async () => {
    const parentProject = project('parent', 'demo', MARKER);
    const childProject = project('db-child', 'demo/db', MARKER);
    const parentService = service('parent__svc', {
      kind: 'compose',
      parent_service_id: null,
      runtime_role: 'application',
      archived_at: MARKER,
    });
    const childService = service('db-child__svc', {
      status: 'stopped',
      archived_at: MARKER,
      container_id: 'db-container-1234567890',
      container_name: 'ol-demo-db-archived-db-container',
      image_tag: 'postgres:17-alpine',
    });
    const unarchiveProject = vi.fn(async () => undefined);
    const updateService = vi.fn(async () => undefined);
    const db = {
      getProject: vi.fn(async (id: string) =>
        id === parentProject.id ? parentProject : childProject,
      ),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === parentProject.id ? parentService : childService,
      ),
      getComposeChildProjects: vi.fn(async (id: string) =>
        id === parentProject.id ? [childProject] : [],
      ),
      unarchiveProject,
      updateService,
      getUsedPorts: vi.fn(async () => []),
      updateProject: vi.fn(async () => undefined),
    } as unknown as Database;
    const runtime = {
      inspectContainer: vi.fn(async () => {
        throw new Error('No such container: ol-demo-db');
      }),
      renameContainer: vi.fn(async () => undefined),
      ensureProjectNetwork: vi.fn(async () => 'ol-demo'),
      connectContainerToNetwork: vi.fn(async () => undefined),
      disconnectContainerFromNetwork: vi.fn(async () => undefined),
      startContainer: vi.fn(async () => undefined),
      listAllContainers: vi.fn(async () => []),
    } as unknown as RuntimeBackend;
    const lifecycle = new ContainerLifecycle(runtime, db);

    await lifecycle.unarchive('parent');

    expect(runtime.renameContainer).toHaveBeenCalledWith(
      'db-container-1234567890',
      'ol-demo-db',
    );
    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(
      'db-container-1234567890',
      'ol-demo',
      ['db'],
    );
    expect(runtime.startContainer).toHaveBeenCalledWith('db-container-1234567890');
    expect(unarchiveProject.mock.calls.map(([id]) => id)).toEqual(['db-child', 'parent']);
    expect(updateService).toHaveBeenCalledWith('db-child__svc', {
      archivedAt: null,
      status: 'running',
      containerId: 'db-container-1234567890',
      containerName: 'ol-demo-db',
    });
  });
});
