import { describe, it, expect, vi } from 'vitest';

import {
  assertProjectLifecycleMutable,
  assertProjectMutable,
  type LifecycleAction,
} from '../../src/pipeline/mutation-policy.js';
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

// ---------------------------------------------------------------------------
// assertProjectLifecycleMutable — start / stop / archive / purge
//
// Policy matrix encoded by the helper:
//
// | action  | archived | recovering | circuit_open |
// | ------- | -------- | ---------- | ------------ |
// | start   | reject   | reject     | reject       |
// | stop    | reject   | allow      | allow        |
// | archive | reject   | reject     | reject       |
// | purge   | allow    | reject     | reject       |
//
// `stop` is the operator escape hatch: a stuck recovery loop or open
// circuit breaker must be breakable without unarchiving first.
// `purge` is the only action that targets archived projects.
// ---------------------------------------------------------------------------

describe('assertProjectLifecycleMutable', () => {
  describe('action: start', () => {
    it('rejects archived projects', () => {
      const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
      expect(() => assertProjectLifecycleMutable(project, 'start', makeCtx())).toThrow(
        ProjectArchivedError,
      );
    });

    it('rejects recovering projects', () => {
      const project = makeProject({ status: 'recovering' });
      expect(() => assertProjectLifecycleMutable(project, 'start', makeCtx())).toThrow(
        ProjectRecoveringError,
      );
    });

    it('rejects when circuit breaker is open', () => {
      const project = makeProject();
      expect(() =>
        assertProjectLifecycleMutable(project, 'start', makeCtx({ circuitBreakerOpen: true })),
      ).toThrow(CircuitBreakerOpenError);
    });

    it('allows healthy running project', () => {
      const project = makeProject();
      expect(() => assertProjectLifecycleMutable(project, 'start', makeCtx())).not.toThrow();
    });
  });

  describe('action: stop (operator escape hatch)', () => {
    it('rejects archived projects', () => {
      const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
      expect(() => assertProjectLifecycleMutable(project, 'stop', makeCtx())).toThrow(
        ProjectArchivedError,
      );
    });

    it('allows recovering projects (escape hatch to break stuck recovery loop)', () => {
      const project = makeProject({ status: 'recovering' });
      expect(() => assertProjectLifecycleMutable(project, 'stop', makeCtx())).not.toThrow();
    });

    it('allows when circuit breaker is open (escape hatch to manually halt)', () => {
      const project = makeProject();
      expect(() =>
        assertProjectLifecycleMutable(project, 'stop', makeCtx({ circuitBreakerOpen: true })),
      ).not.toThrow();
    });

    it('does not consult the circuit breaker for stop (escape hatch is unconditional)', () => {
      const project = makeProject();
      const ctx = makeCtx();
      assertProjectLifecycleMutable(project, 'stop', ctx);
      expect(ctx.db.isCircuitBreakerOpen).not.toHaveBeenCalled();
    });
  });

  describe('action: archive', () => {
    it('rejects already-archived projects (re-archive is a silent no-op)', () => {
      const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
      expect(() => assertProjectLifecycleMutable(project, 'archive', makeCtx())).toThrow(
        ProjectArchivedError,
      );
    });

    it('rejects recovering projects (do not archive mid-recovery)', () => {
      const project = makeProject({ status: 'recovering' });
      expect(() => assertProjectLifecycleMutable(project, 'archive', makeCtx())).toThrow(
        ProjectRecoveringError,
      );
    });

    it('rejects when circuit breaker is open', () => {
      const project = makeProject();
      expect(() =>
        assertProjectLifecycleMutable(project, 'archive', makeCtx({ circuitBreakerOpen: true })),
      ).toThrow(CircuitBreakerOpenError);
    });

    it('allows healthy running project', () => {
      const project = makeProject();
      expect(() => assertProjectLifecycleMutable(project, 'archive', makeCtx())).not.toThrow();
    });
  });

  describe('action: purge', () => {
    it('allows archived projects (purge is the documented removal path)', () => {
      const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
      expect(() => assertProjectLifecycleMutable(project, 'purge', makeCtx())).not.toThrow();
    });

    it('rejects recovering projects (do not purge mid-recovery)', () => {
      const project = makeProject({
        status: 'recovering',
        archived_at: '2024-06-01T00:00:00Z',
      });
      expect(() => assertProjectLifecycleMutable(project, 'purge', makeCtx())).toThrow(
        ProjectRecoveringError,
      );
    });

    it('rejects when circuit breaker is open even on archived project', () => {
      const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
      expect(() =>
        assertProjectLifecycleMutable(project, 'purge', makeCtx({ circuitBreakerOpen: true })),
      ).toThrow(CircuitBreakerOpenError);
    });

    it('allows non-archived running project (CLI/API may purge directly without prior archive)', () => {
      const project = makeProject();
      expect(() => assertProjectLifecycleMutable(project, 'purge', makeCtx())).not.toThrow();
    });
  });

  describe('precedence and exhaustiveness', () => {
    it('archived takes precedence over recovering for non-purge actions', () => {
      const project = makeProject({
        archived_at: '2024-06-01T00:00:00Z',
        status: 'recovering',
      });
      // start, stop, archive all hit the archived gate before the recovering gate
      for (const action of ['start', 'stop', 'archive'] as const satisfies LifecycleAction[]) {
        expect(() => assertProjectLifecycleMutable(project, action, makeCtx())).toThrow(
          ProjectArchivedError,
        );
      }
    });

    it('archived gate is skipped for purge so recovering surfaces correctly', () => {
      const project = makeProject({
        archived_at: '2024-06-01T00:00:00Z',
        status: 'recovering',
      });
      expect(() => assertProjectLifecycleMutable(project, 'purge', makeCtx())).toThrow(
        ProjectRecoveringError,
      );
    });
  });
});
