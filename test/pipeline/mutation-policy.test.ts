import { describe, it, expect, vi } from 'vitest';

import { assertProjectMutable } from '../../src/pipeline/mutation-policy.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../../src/errors.js';
import type { ProjectRow } from '../../src/db/index.js';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
    name: 'my-app',
    status: 'running',
    source: 'git',
    repo_url: 'https://github.com/test/repo',
    archived_at: null,
    container_id: 'ctr-abc',
    image_tag: 'openlander/my-app:latest',
    previous_image_tag: null,
    assigned_port: 3001,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    image_url: null,
    image_cmd: null,
    container_port: null,
    visibility: 'internal',
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    branch: 'main',
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ProjectRow;
}

function makeCtx(opts: { circuitBreakerOpen?: boolean } = {}) {
  return {
    db: {
      isCircuitBreakerOpen: vi.fn().mockReturnValue(opts.circuitBreakerOpen ?? false),
    },
  };
}

describe('assertProjectMutable', () => {
  it('throws ProjectArchivedError when project is archived', () => {
    const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
    expect(() => assertProjectMutable(project, makeCtx())).toThrow(ProjectArchivedError);
  });

  it('throws ProjectRecoveringError when project status is recovering', () => {
    const project = makeProject({ status: 'recovering' });
    expect(() => assertProjectMutable(project, makeCtx())).toThrow(ProjectRecoveringError);
  });

  it('throws CircuitBreakerOpenError when circuit breaker is open', () => {
    const project = makeProject();
    expect(() => assertProjectMutable(project, makeCtx({ circuitBreakerOpen: true }))).toThrow(
      CircuitBreakerOpenError,
    );
  });

  it('does not throw for healthy running project', () => {
    const project = makeProject();
    expect(() => assertProjectMutable(project, makeCtx())).not.toThrow();
  });

  it('archived takes precedence over circuit breaker', () => {
    const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
    const ctx = makeCtx({ circuitBreakerOpen: true });
    expect(() => assertProjectMutable(project, ctx)).toThrow(ProjectArchivedError);
    expect(ctx.db.isCircuitBreakerOpen).not.toHaveBeenCalled();
  });

  it('recovering takes precedence over circuit breaker', () => {
    const project = makeProject({ status: 'recovering' });
    const ctx = makeCtx({ circuitBreakerOpen: true });
    expect(() => assertProjectMutable(project, ctx)).toThrow(ProjectRecoveringError);
    expect(ctx.db.isCircuitBreakerOpen).not.toHaveBeenCalled();
  });
});
