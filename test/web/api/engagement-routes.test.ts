import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { OpenLanderError } from '../../../src/errors.js';
import { createEngagementRoutes } from '../../../src/web/api/engagement-routes.js';
import { createAuthMiddleware } from '../../../src/web/middleware/auth.js';

type AuthKind = 'session' | 'api_token' | 'project_pat';

function harness(authKind: AuthKind) {
  const detail = {
    id: 'engagement-1',
    customer_name: 'Atlas Synthetic',
    title: 'Atlas rollout',
    status: 'active',
    projects: [],
    deliveries: [],
    blockers: [
      {
        kind: 'revision_requested',
        project_id: 'project-1',
        delivery_id: 'delivery-1',
        resource_id: 'delivery-1',
        title: 'Revision requested',
        detail: 'Legacy fallback text',
        metadata: { delivery_status: 'revision_requested' },
      },
    ],
    recent_activity: [
      {
        id: 'activity-1',
        event_type: 'engagement:created',
        title: 'Legacy fallback title',
        description: 'Legacy fallback description',
        metadata: {
          schema_version: 1,
          engagement_id: 'engagement-1',
          engagement_title: 'Atlas rollout',
        },
      },
    ],
  };
  const engagementService = {
    list: vi.fn(async () => [detail]),
    get: vi.fn(async () => detail),
    create: vi.fn(async () => detail),
    update: vi.fn(async () => detail),
    archive: vi.fn(async () => ({ ...detail, status: 'archived' })),
    unarchive: vi.fn(async () => detail),
    linkProject: vi.fn(async () => detail),
    unlinkProject: vi.fn(async () => detail),
    listUnassignedProjects: vi.fn(async () => [
      { id: 'project-1', name: 'atlas-web', display_name: 'Atlas Web', archived_at: null },
    ]),
    getProjectReference: vi.fn(async () => ({
      id: 'engagement-1',
      customer_name: 'Atlas Synthetic',
      title: 'Atlas rollout',
      status: 'active',
    })),
  };
  const report = {
    id: 'report-1',
    engagement_id: 'engagement-1',
    period_start: '2026-07-20',
    period_end: '2026-07-26',
    revision: 1,
    status: 'published',
    evidence_snapshot: { internal: 'must not be returned by the list route' },
    evidence_sha256: 'a'.repeat(64),
    internal_sha256: 'b'.repeat(64),
    customer_sha256: 'c'.repeat(64),
    created_at: '2026-07-26T00:00:00.000Z',
    published_at: '2026-07-26T00:01:00.000Z',
  };
  const weeklyReportService = {
    list: vi.fn(async () => [report]),
    getPublishedArtifact: vi.fn(async () => ({
      report,
      blob: {
        mime_type: 'application/pdf',
        size_bytes: 11,
        storage_key: 'sha256/report',
      },
      filename: 'report-1-customer-r1.pdf',
    })),
  };
  const artifactStore = {
    open: vi.fn(() => Readable.from([Buffer.from('report-pdf')])),
  };
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(
        { code: error.code, message: error.message, details: error.details },
        error.statusCode as 400,
      );
    }
    throw error;
  });
  app.use('*', async (c, next) => {
    c.set('authKind', authKind);
    await next();
  });
  app.route(
    '/api',
    createEngagementRoutes({
      engagementService,
      weeklyReportService,
      artifactStore,
    } as unknown as AppContext),
  );
  return { app, engagementService, weeklyReportService };
}

describe('Engagement REST routes', () => {
  it('allows authenticated reads and exposes unassigned Projects without mutation', async () => {
    const { app, engagementService } = harness('api_token');
    const list = await app.request('/api/engagements');
    const detail = await app.request('/api/engagements/engagement-1');
    const unassigned = await app.request('/api/engagements/unassigned-projects');
    const reference = await app.request('/api/projects/project-1/engagement');

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      engagements: [{ id: 'engagement-1' }],
    });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      blockers: [
        {
          kind: 'revision_requested',
          metadata: { delivery_status: 'revision_requested' },
        },
      ],
      recent_activity: [
        {
          event_type: 'engagement:created',
          metadata: {
            schema_version: 1,
            engagement_id: 'engagement-1',
            engagement_title: 'Atlas rollout',
          },
        },
      ],
    });
    expect(unassigned.status).toBe(200);
    await expect(unassigned.json()).resolves.toMatchObject({
      projects: [{ id: 'project-1' }],
    });
    await expect(reference.json()).resolves.toMatchObject({
      engagement: { id: 'engagement-1' },
    });
    expect(engagementService.get).toHaveBeenCalledWith('engagement-1');
  });

  it('lists redacted report metadata and streams a published PDF with safe headers', async () => {
    const { app, weeklyReportService } = harness('api_token');
    const list = await app.request('/api/engagements/engagement-1/weekly-reports');
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body).toMatchObject({ reports: [{ id: 'report-1', status: 'published' }] });
    expect(JSON.stringify(body)).not.toContain('evidence_snapshot');
    expect(JSON.stringify(body)).not.toContain('must not be returned');

    const pdf = await app.request(
      '/api/engagements/engagement-1/weekly-reports/report-1/customer/pdf',
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-disposition')).toContain('inline');
    expect(pdf.headers.get('content-security-policy')).toContain('sandbox');
    expect(pdf.headers.get('cache-control')).toBe('private, no-store');
    expect(await pdf.text()).toBe('report-pdf');
    expect(weeklyReportService.getPublishedArtifact).toHaveBeenCalledWith({
      engagementId: 'engagement-1',
      reportId: 'report-1',
      audience: 'customer',
      format: 'pdf',
    });
  });

  it.each<AuthKind>(['api_token', 'project_pat'])(
    'rejects every Engagement mutation for %s authentication',
    async (authKind) => {
      const { app, engagementService } = harness(authKind);
      const requests = [
        app.request('/api/engagements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ customer_name: 'Atlas Synthetic', title: 'Atlas rollout' }),
        }),
        app.request('/api/engagements/engagement-1', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Changed' }),
        }),
        app.request('/api/engagements/engagement-1/archive', { method: 'POST' }),
        app.request('/api/engagements/engagement-1/unarchive', { method: 'POST' }),
        app.request('/api/engagements/engagement-1/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: 'project-1' }),
        }),
        app.request('/api/engagements/engagement-1/projects/project-1', {
          method: 'DELETE',
        }),
      ];

      for (const response of await Promise.all(requests)) {
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: 'ENGAGEMENT_WEB_SESSION_REQUIRED',
        });
      }
      expect(engagementService.create).not.toHaveBeenCalled();
      expect(engagementService.update).not.toHaveBeenCalled();
      expect(engagementService.archive).not.toHaveBeenCalled();
      expect(engagementService.unarchive).not.toHaveBeenCalled();
      expect(engagementService.linkProject).not.toHaveBeenCalled();
      expect(engagementService.unlinkProject).not.toHaveBeenCalled();
    },
  );

  it('allows administrator web sessions to create, edit, archive, and link', async () => {
    const { app, engagementService } = harness('session');
    const created = await app.request('/api/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Atlas Synthetic',
        title: 'Atlas rollout',
        summary: 'Synthetic engagement',
      }),
    });
    const updated = await app.request('/api/engagements/engagement-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'on_hold' }),
    });
    const linked = await app.request('/api/engagements/engagement-1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: 'project-1' }),
    });
    const archived = await app.request('/api/engagements/engagement-1/archive', {
      method: 'POST',
    });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(linked.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(engagementService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Atlas Synthetic', actor: 'admin' }),
    );
    expect(engagementService.update).toHaveBeenCalledWith(
      'engagement-1',
      expect.objectContaining({ status: 'on_hold', actor: 'admin' }),
    );
    expect(engagementService.linkProject).toHaveBeenCalledWith(
      'engagement-1',
      'project-1',
      'admin',
    );
  });

  it('rejects a Project PAT at the production auth middleware before route mutation', async () => {
    const { engagementService } = harness('session');
    const authService = {
      validateSession: vi.fn(async () => false),
      validateApiToken: vi.fn(async () => false),
      validateMcpBearerToken: vi.fn(async () => ({
        tokenId: 'pat-1',
        name: 'Project Agent',
        tokenType: 'pat',
        scopeKind: 'project',
        scopeProjectId: 'project-1',
        scopeServiceId: null,
      })),
      isPasswordSet: vi.fn(async () => true),
    } as unknown as AuthService;
    const app = new Hono();
    app.use('*', createAuthMiddleware(authService));
    app.route('/api', createEngagementRoutes({ engagementService } as unknown as AppContext));

    const response = await app.request('/api/engagements', {
      method: 'POST',
      headers: {
        authorization: 'Bearer olp_project_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customer_name: 'Atlas Synthetic', title: 'Atlas rollout' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'MCP_TOKEN_USED_ON_REST_API',
    });
    expect(engagementService.create).not.toHaveBeenCalled();
  });
});
