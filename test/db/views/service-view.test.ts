import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/db/index.js';
import type { ProjectRow, ServiceRow } from '../../../src/db/types.js';
import {
  loadServiceView,
  loadServiceViewRecord,
  loadServiceViewRecords,
  serviceViewFromRows,
  type ServiceView,
} from '../../../src/db/views/service-view.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p-1',
    name: 'p-1',
    display_name: 'P 1',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p-1__svc',
    project_id: 'p-1',
    name: 'p-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 9100,
    container_id: 'container-1',
    container_name: 'ol-p1',
    container_port: 3000,
    image_tag: 'p-1:tag',
    previous_image_tag: 'p-1:prev',
    public_url: 'https://app.example.com',
    dockerfile_path: 'Dockerfile',
    docker_target: 'production',
    build_context: '.',
    build_method: 'dockerfile',
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
    image_cmd: '["node","server.js"]',
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/health',
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

describe('serviceViewFromRows', () => {
  it('projects every field from the service row when both rows agree', () => {
    const view = serviceViewFromRows(makeProjectRow(), makeServiceRow());

    expect(view).toMatchObject<Partial<ServiceView>>({
      id: 'p-1__svc',
      projectId: 'p-1',
      projectName: 'p-1',
      name: 'p-1__svc',
      status: 'running',
      containerId: 'container-1',
      containerName: 'ol-p1',
      assignedPort: 9100,
      containerPort: 3000,
      publicUrl: 'https://app.example.com',
      source: 'image',
      imageUrl: 'nginx:alpine',
      imageTag: 'p-1:tag',
      previousImageTag: 'p-1:prev',
      imageCmdRaw: '["node","server.js"]',
      dockerfilePath: 'Dockerfile',
      dockerTarget: 'production',
      buildContext: '.',
      buildMethod: 'dockerfile',
      healthCheckStrategy: 'http',
      healthCheckPath: '/health',
      isPreview: false,
      prNumber: null,
      visibility: 'internal',
      pendingFix: null,
      recoveringStartedAt: null,
    });
  });

  it('falls back to project columns when the deployable row is missing', () => {
    const view = serviceViewFromRows(
      makeProjectRow({
        status: 'stopped',
        container_id: 'legacy-container',
        assigned_port: 8080,
        image_tag: 'legacy:tag',
        image_url: 'legacy/image:latest',
        build_method: 'compose',
        health_check_strategy: 'tcp',
      }),
      null,
    );

    expect(view.status).toBe('stopped');
    expect(view.containerId).toBe('legacy-container');
    expect(view.assignedPort).toBe(8080);
    expect(view.imageTag).toBe('legacy:tag');
    expect(view.imageUrl).toBe('legacy/image:latest');
    expect(view.buildMethod).toBe('compose');
    expect(view.healthCheckStrategy).toBe('tcp');
  });

  it('normalizes status to "idle" when neither row supplies one', () => {
    const view = serviceViewFromRows(makeProjectRow({ status: null }), null);

    expect(view.status).toBe('idle');
  });

  it('prefers the deployable row over the project fallback when both have a value', () => {
    const view = serviceViewFromRows(
      makeProjectRow({ status: 'building', container_id: 'old-container' }),
      makeServiceRow({ status: 'running', container_id: 'new-container' }),
    );

    expect(view.status).toBe('running');
    expect(view.containerId).toBe('new-container');
  });

  it('coerces is_preview to a boolean regardless of the underlying 0 / 1 / null encoding', () => {
    expect(serviceViewFromRows(makeProjectRow(), makeServiceRow({ is_preview: 1 })).isPreview).toBe(
      true,
    );
    expect(serviceViewFromRows(makeProjectRow(), makeServiceRow({ is_preview: 0 })).isPreview).toBe(
      false,
    );
    expect(
      serviceViewFromRows(makeProjectRow(), makeServiceRow({ is_preview: null })).isPreview,
    ).toBe(false);
  });

  it('defaults visibility to "internal" when neither row carries one', () => {
    const view = serviceViewFromRows(
      makeProjectRow({ visibility: undefined }),
      makeServiceRow({ visibility: null }),
    );

    expect(view.visibility).toBe('internal');
  });

  it('derives identity fields from the project for legacy standalone projects', () => {
    const view = serviceViewFromRows(makeProjectRow({ id: 'legacy', name: 'legacy' }), null);

    expect(view.id).toBe('legacy__svc');
    expect(view.projectId).toBe('legacy');
    expect(view.projectName).toBe('legacy');
    expect(view.name).toBe('legacy__svc');
  });

  it('projects the S1.3 fields (projectType / accessCode / accessCodeIv) from the deployable row', () => {
    const view = serviceViewFromRows(
      makeProjectRow(),
      makeServiceRow({
        project_type: 'worker',
        access_code: 'enc-blob',
        access_code_iv: 'enc-iv',
      }),
    );

    expect(view.projectType).toBe('worker');
    expect(view.accessCode).toBe('enc-blob');
    expect(view.accessCodeIv).toBe('enc-iv');
  });

  it('falls back to project columns for the S1.3 fields when the deployable is missing', () => {
    const view = serviceViewFromRows(
      makeProjectRow({
        project_type: 'web',
        access_code: 'legacy-blob',
        access_code_iv: 'legacy-iv',
      }),
      null,
    );

    expect(view.projectType).toBe('web');
    expect(view.accessCode).toBe('legacy-blob');
    expect(view.accessCodeIv).toBe('legacy-iv');
  });

  it('transforms parent_service_id back to a project id via the view layer', () => {
    const view = serviceViewFromRows(
      makeProjectRow(),
      makeServiceRow({ parent_service_id: 'parent-group__svc' }),
    );

    // `deployableServiceIdToProjectId` strips the `__svc` suffix.
    expect(view.parentProjectId).toBe('parent-group');
  });

  it('falls back to project.parent_project_id when no service-side pointer exists', () => {
    const view = serviceViewFromRows(
      makeProjectRow({ parent_project_id: 'parent-group' }),
      makeServiceRow({ parent_service_id: null }),
    );

    expect(view.parentProjectId).toBe('parent-group');
  });
});

describe('loadServiceView', () => {
  it('queries the deployable row exactly once and threads it into the projection', async () => {
    const service = makeServiceRow({ assigned_port: 9999 });
    const getDeployableForProject = vi.fn(async () => service);
    const db = { getDeployableForProject } as unknown as Pick<Database, 'getDeployableForProject'>;

    const view = await loadServiceView(db, makeProjectRow());

    expect(getDeployableForProject).toHaveBeenCalledTimes(1);
    expect(getDeployableForProject).toHaveBeenCalledWith('p-1');
    expect(view.assignedPort).toBe(9999);
  });

  it('treats a missing deployable as the legacy-fallback case (no throw)', async () => {
    const getDeployableForProject = vi.fn(async () => undefined);
    const db = { getDeployableForProject } as unknown as Pick<Database, 'getDeployableForProject'>;

    const view = await loadServiceView(
      db,
      makeProjectRow({ status: 'stopped', container_id: 'legacy', assigned_port: 4000 }),
    );

    expect(view.status).toBe('stopped');
    expect(view.containerId).toBe('legacy');
    expect(view.assignedPort).toBe(4000);
  });
});

describe('loadServiceViewRecord', () => {
  it('returns the project, canonical service row, and projection together', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ assigned_port: 9999 });
    const getDeployableForProject = vi.fn(async () => service);
    const db = { getDeployableForProject } as unknown as Pick<Database, 'getDeployableForProject'>;

    const record = await loadServiceViewRecord(db, project);

    expect(record.project).toBe(project);
    expect(record.service).toBe(service);
    expect(record.view.assignedPort).toBe(9999);
    expect(getDeployableForProject).toHaveBeenCalledWith('p-1');
  });
});

describe('loadServiceViewRecords', () => {
  it('does not query services when no project rows are provided', async () => {
    const getServices = vi.fn(async () => []);
    const db = { getServices } as unknown as Pick<Database, 'getServices'>;

    const records = await loadServiceViewRecords(db, []);

    expect(records.size).toBe(0);
    expect(getServices).not.toHaveBeenCalled();
  });

  it('loads canonical deployable rows for multiple projects in one service query', async () => {
    const projects = [
      makeProjectRow({ id: 'p-1', name: 'one' }),
      makeProjectRow({ id: 'p-2', name: 'two', status: 'stopped', assigned_port: 8080 }),
    ];
    const service = makeServiceRow({ id: 'p-1__svc', project_id: 'p-1', assigned_port: 9999 });
    const getServices = vi.fn(async () => [service]);
    const db = { getServices } as unknown as Pick<Database, 'getServices'>;

    const records = await loadServiceViewRecords(db, projects);

    expect(getServices).toHaveBeenCalledTimes(1);
    expect(getServices).toHaveBeenCalledWith({ ids: ['p-1__svc', 'p-2__svc'] });
    expect(records.get('p-1')?.service).toBe(service);
    expect(records.get('p-1')?.view.assignedPort).toBe(9999);
    expect(records.get('p-2')?.service).toBeNull();
    expect(records.get('p-2')?.view.status).toBe('stopped');
    expect(records.get('p-2')?.view.assignedPort).toBe(8080);
  });
});
