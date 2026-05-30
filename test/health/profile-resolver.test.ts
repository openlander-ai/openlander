import { describe, it, expect } from 'vitest';
import { resolveMonitoringProfile } from '../../src/health/profile-resolver.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';

/**
 * Helper to create a minimal ProjectRow for testing
 */
const makeProject = (overrides: Partial<ProjectRow>): ProjectRow =>
  ({
    id: 'test-id',
    name: 'test-project',
    repo_url: null,
    branch: 'main',
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'git',
    image_url: null,
    image_cmd: null,
    container_port: null,
    pending_fix: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    archived_at: null,
    deploy_lock_session: null,
    deploy_lock_at: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    ...overrides,
  }) as ProjectRow;

const makeService = (overrides: Partial<ServiceRow>): ServiceRow =>
  ({
    id: 'test-id__svc',
    project_id: 'test-id',
    name: 'test-project__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    container_name: null,
    container_port: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'git',
    repo_url: null,
    branch: 'main',
    image_url: null,
    image_cmd: null,
    health_check_strategy: null,
    health_check_path: null,
    pending_fix: null,
    recovering_started_at: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    access_code: null,
    access_code_iv: null,
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }) as ServiceRow;

describe('resolveMonitoringProfile', () => {
  it('web project returns http strategy with traefik enabled', () => {
    const project = makeProject({ project_type: 'web' });
    const profile = resolveMonitoringProfile(project);

    expect(profile.projectType).toBe('web');
    expect(profile.health.strategy).toBe('http');
    expect(profile.health.path).toBe('/');
    expect(profile.health.timeoutMs).toBe(5000);
    expect(profile.health.intervalMs).toBe(30000);
    expect(profile.health.failureThreshold).toBe(3);
    expect(profile.health.dockerHealthPolicy).toBe('prefer');
    expect(profile.exposeViaTraefik).toBe(true);
  });

  it('worker project returns none strategy with traefik disabled', () => {
    const project = makeProject({ project_type: 'worker' });
    const profile = resolveMonitoringProfile(project);

    expect(profile.projectType).toBe('worker');
    expect(profile.health.strategy).toBe('none');
    expect(profile.health.timeoutMs).toBe(5000);
    expect(profile.health.intervalMs).toBe(30000);
    expect(profile.health.failureThreshold).toBe(3);
    expect(profile.health.dockerHealthPolicy).toBe('prefer');
    expect(profile.exposeViaTraefik).toBe(false);
  });

  it('web project with tcp override uses tcp strategy', () => {
    const project = makeProject({
      project_type: 'web',
      health_check_strategy: 'tcp',
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.strategy).toBe('tcp');
    expect(profile.exposeViaTraefik).toBe(true);
  });

  it('worker project with exec override uses exec strategy', () => {
    const project = makeProject({
      project_type: 'worker',
      health_check_strategy: 'exec',
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.strategy).toBe('exec');
    expect(profile.exposeViaTraefik).toBe(false);
  });

  it('health_check_path without leading slash gets normalized', () => {
    const project = makeProject({
      project_type: 'web',
      health_check_path: 'healthz',
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.path).toBe('/healthz');
  });

  it('health_check_path with leading slash is not double-slashed', () => {
    const project = makeProject({
      project_type: 'web',
      health_check_path: '/api/health',
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.path).toBe('/api/health');
  });

  it('null health_check_strategy uses project_type default', () => {
    const webProject = makeProject({
      project_type: 'web',
      health_check_strategy: null,
    });
    const webProfile = resolveMonitoringProfile(webProject);
    expect(webProfile.health.strategy).toBe('http');

    const workerProject = makeProject({
      project_type: 'worker',
      health_check_strategy: null,
    });
    const workerProfile = resolveMonitoringProfile(workerProject);
    expect(workerProfile.health.strategy).toBe('none');
  });

  it('null health_check_path uses default "/" for web', () => {
    const project = makeProject({
      project_type: 'web',
      health_check_path: null,
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.path).toBe('/');
  });

  it('worker with http override gets http strategy but no traefik', () => {
    const project = makeProject({
      project_type: 'worker',
      health_check_strategy: 'http',
    });
    const profile = resolveMonitoringProfile(project);

    expect(profile.health.strategy).toBe('http');
    expect(profile.exposeViaTraefik).toBe(false);
  });

  it('uses canonical service health fields before deprecated project fields', () => {
    const project = makeProject({
      project_type: 'web',
      health_check_strategy: 'http',
      health_check_path: '/project-health',
    });
    const service = makeService({
      project_type: 'worker',
      health_check_strategy: 'exec',
      health_check_path: 'service-health',
    });

    const profile = resolveMonitoringProfile(project, service);

    expect(profile.projectType).toBe('worker');
    expect(profile.exposeViaTraefik).toBe(false);
    expect(profile.health.strategy).toBe('exec');
    expect(profile.health.path).toBeUndefined();
  });
});
