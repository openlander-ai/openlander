import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createMigrationRoutes } from '../../src/web/api/migration-routes.js';

function appFor(options: {
  project?: { id: string; name: string };
  bundle?: unknown;
  runbookBundle?: unknown;
  preflight?: unknown;
  rehearsal?: unknown;
  authKind?: 'session' | 'api_token' | null;
}) {
  const projectMigrationService = {
    createBundle: vi.fn(async () => options.bundle),
    createPostgresMigrationRunbookBundle: vi.fn(async () => options.runbookBundle),
    createPostgresMigrationPreflight: vi.fn(async () => options.preflight),
    startPostgresMigrationRehearsal: vi.fn(async () => options.rehearsal),
    getPostgresMigrationRehearsal: vi.fn(() => options.rehearsal),
  };
  const ctx = {
    db: {
      getProject: vi.fn(async (id: string) =>
        id === options.project?.id ? options.project : undefined,
      ),
      getProjectByName: vi.fn(async (name: string) =>
        name === options.project?.name ? options.project : undefined,
      ),
    },
    projectMigrationService,
  } as unknown as AppContext;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('authKind', options.authKind ?? null);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(error.toJSON(), error.statusCode as 404);
    }
    throw error;
  });
  app.route('/api', createMigrationRoutes(ctx));
  return { app, projectMigrationService };
}

describe('migration routes', () => {
  it('returns one in-memory snapshot and target bundle generated at the same time', async () => {
    const bundle = {
      snapshot: {
        schema_version: 'openlander.project-migration/v1',
        generated_at: '2026-08-22T00:00:00.000Z',
      },
      document_markdown: 'Generated at 2026-08-22T00:00:00.000Z',
      target_comparison: {
        schema_version: 'openlander.project-migration-targets/v1',
        generated_at: '2026-08-22T00:00:00.000Z',
        targets: [{ id: 'aws_ecs_fargate' }, { id: 'gcp_cloud_run' }],
      },
      target_document_markdown: 'Generated at 2026-08-22T00:00:00.000Z',
    };
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
      bundle,
    });

    const response = await app.request('/api/projects/example/migration');

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual(bundle);
    expect(result.snapshot.generated_at).toBe(result.target_comparison.generated_at);
    expect(result.document_markdown).toContain(result.snapshot.generated_at);
    expect(result.target_document_markdown).toContain(result.snapshot.generated_at);
    expect(projectMigrationService.createBundle).toHaveBeenCalledWith('project-1');
  });

  it('returns a typed 404 for an unknown Project', async () => {
    const { app, projectMigrationService } = appFor({});

    const response = await app.request('/api/projects/missing/migration');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(projectMigrationService.createBundle).not.toHaveBeenCalled();
  });

  it('returns a PostgreSQL runbook and Markdown generated from the same snapshot time', async () => {
    const runbookBundle = {
      runbook: {
        schema_version: 'openlander.postgresql-migration-runbook/v1',
        generated_at: '2026-08-22T00:00:00.000Z',
        source_service: { id: 'postgres-1' },
        target: { id: 'aws_rds_postgresql' },
      },
      document_markdown: 'Generated at: 2026-08-22T00:00:00.000Z',
    };
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
      runbookBundle,
    });

    const response = await app.request(
      '/api/projects/example/migration/runbook?target=aws_rds_postgresql&service_id=postgres-1',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(runbookBundle);
    expect(projectMigrationService.createPostgresMigrationRunbookBundle).toHaveBeenCalledWith(
      'project-1',
      'aws_rds_postgresql',
      'postgres-1',
    );
  });

  it('rejects a missing or unsupported PostgreSQL target with a typed 400', async () => {
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
    });

    const response = await app.request('/api/projects/example/migration/runbook?target=azure');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'POSTGRES_MIGRATION_TARGET_INVALID',
    });
    expect(projectMigrationService.createPostgresMigrationRunbookBundle).not.toHaveBeenCalled();
  });

  it('runs a read-only PostgreSQL preflight for the selected Project resource', async () => {
    const preflight = {
      schema_version: 'openlander.postgresql-preflight/v1',
      source_service: { id: 'postgres-1' },
      inspection_policy: { row_contents_read: false, credentials_included: false },
    };
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
      preflight,
    });

    const response = await app.request('/api/projects/example/migration/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: 'postgres-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ preflight });
    expect(projectMigrationService.createPostgresMigrationPreflight).toHaveBeenCalledWith(
      'project-1',
      'postgres-1',
    );
  });

  it('requires a web session before accepting rehearsal credentials', async () => {
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
      authKind: 'api_token',
    });

    const response = await app.request('/api/projects/example/migration/rehearsals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'WEB_SESSION_REQUIRED' });
    expect(projectMigrationService.startPostgresMigrationRehearsal).not.toHaveBeenCalled();
  });

  it('starts and polls a redacted in-memory rehearsal from the web session', async () => {
    const rehearsal = {
      schema_version: 'openlander.postgresql-rehearsal/v1',
      run_id: 'run-1',
      project_id: 'project-1',
      service_id: 'postgres-1',
      status: 'queued',
      target: { host: 'db.example.com', database: 'target_db' },
      execution_policy: { credentials_stored: false, credentials_returned: false },
    };
    const { app, projectMigrationService } = appFor({
      project: { id: 'project-1', name: 'example' },
      rehearsal,
      authKind: 'session',
    });
    const input = {
      service_id: 'postgres-1',
      target: {
        provider: 'aws_rds_postgresql',
        host: 'db.example.com',
        port: 5432,
        database: 'target_db',
        user: 'target_user',
        password: 'request-only-secret',
        ssl_mode: 'require',
        confirm_empty_target: true,
      },
    };

    const started = await app.request('/api/projects/example/migration/rehearsals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    expect(startedBody).toEqual({ rehearsal });
    expect(JSON.stringify(startedBody)).not.toContain('request-only-secret');
    expect(projectMigrationService.startPostgresMigrationRehearsal).toHaveBeenCalledWith(
      'project-1',
      'postgres-1',
      input.target,
    );

    const polled = await app.request('/api/projects/example/migration/rehearsals/run-1');
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toEqual({ rehearsal });
    expect(projectMigrationService.getPostgresMigrationRehearsal).toHaveBeenCalledWith(
      'project-1',
      'run-1',
    );
  });
});
