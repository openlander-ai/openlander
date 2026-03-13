import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';
import { scanForEnvUsage } from '../src/pipeline/env-scan.js';
import { cloneRepo } from '../src/pipeline/git.js';
import { createApiRoutes } from '../src/web/api/routes.js';
import { WebhookManager } from '../src/webhook/index.js';
import { createMockContext } from './helpers/web-route-mocks.js';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/mock-clone', commitSha: 'cafebabe1234' }),
}));

vi.mock('../src/pipeline/env-scan.js', () => ({
  scanForEnvUsage: vi.fn().mockReturnValue({
    vars: [
      { key: 'API_URL', files: [{ path: 'src/app.ts', line: 10 }] },
      { key: 'FEATURE_FLAG', files: [{ path: 'src/config.ts', line: 3 }] },
      { key: 'SHARED_TOKEN', files: [{ path: 'src/config.ts', line: 9 }] },
    ],
    hasEnvExample: false,
    language: 'node',
    serviceHints: [],
  }),
}));

describe('multi-environment flow integration', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-multi-env-flow-'));
    db = new Database(join(tmpDir, 'test.db'));
    ctx = createMockContext(db);
    ctx.env = new EnvManager(db) as AppContext['env'];

    app = new Hono();
    app.route('/api', createApiRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('covers project creation through environment switch and env-example generation', async () => {
    db.createProject({
      id: 'flow-p1',
      name: 'flow-app',
      repoUrl: 'https://github.com/openlander/flow-app',
      branch: 'main',
    });

    const productionEnvironment = db
      .getEnvironmentsByProject('flow-p1')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();
    expect(productionEnvironment?.branch).toBe('main');

    const createStagingRes = await app.request('/api/projects/flow-p1/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'staging', branch: 'develop' }),
    });
    expect(createStagingRes.status).toBe(200);

    const createStagingBody = await createStagingRes.json();
    const stagingEnvironmentId = createStagingBody.environment.id as string;
    expect(createStagingBody.environment.type).toBe('staging');
    expect(createStagingBody.environment.branch).toBe('develop');

    const setProductionEnvRes = await app.request(
      `/api/projects/flow-p1/environments/${productionEnvironment!.id}/env`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: {
            API_URL: 'https://prod-api.example.com',
            FEATURE_FLAG: 'off',
            SHARED_TOKEN: 'prod-token-value',
          },
        }),
      },
    );
    expect(setProductionEnvRes.status).toBe(200);

    const setStagingEnvRes = await app.request(
      `/api/projects/flow-p1/environments/${stagingEnvironmentId}/env`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: {
            API_URL: 'https://staging-api.example.com',
            FEATURE_FLAG: 'on',
          },
        }),
      },
    );
    expect(setStagingEnvRes.status).toBe(200);

    const stagingEnvRes = await app.request(
      `/api/projects/flow-p1/environments/${stagingEnvironmentId}/env`,
    );
    expect(stagingEnvRes.status).toBe(200);

    const stagingEnvBody = await stagingEnvRes.json();
    expect(stagingEnvBody.envVars).toMatchObject({
      API_URL: 'https://staging-api.example.com',
      FEATURE_FLAG: 'on',
      SHARED_TOKEN: 'prod-token-value',
    });

    const deployStagingRes = await app.request(
      '/api/projects/flow-p1/redeploy?environment=staging',
      {
        method: 'POST',
      },
    );
    expect(deployStagingRes.status).toBe(200);
    expect(ctx.pipeline.deployEnvironment).toHaveBeenCalledWith('flow-p1', stagingEnvironmentId, {
      trigger: 'api',
    });

    const webhookConfigRes = await app.request('/api/projects/flow-p1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'github', branch_filter: 'develop' }),
    });
    expect(webhookConfigRes.status).toBe(200);
    const webhookConfig = await webhookConfigRes.json();

    const webhookManager = new WebhookManager(
      ctx.pipeline as ConstructorParameters<typeof WebhookManager>[0],
      db as ConstructorParameters<typeof WebhookManager>[1],
      { emit: vi.fn(async () => undefined) } as unknown as ConstructorParameters<
        typeof WebhookManager
      >[2],
    );

    const pushPayload = JSON.stringify({
      ref: 'refs/heads/develop',
      after: '1234567890abcdef',
      repository: {
        clone_url: 'https://github.com/openlander/flow-app',
      },
    });
    const webhookResult = await webhookManager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'flow-p1',
        'x-github-event': 'push',
        'x-hub-signature-256': `sha256=${createHmac('sha256', webhookConfig.secret).update(pushPayload).digest('hex')}`,
      },
      pushPayload,
    );

    expect(webhookResult.accepted).toBe(true);
    expect(ctx.pipeline.deployEnvironment).toHaveBeenCalledWith('flow-p1', stagingEnvironmentId, {
      trigger: 'webhook',
    });

    const projectsRes = await app.request('/api/projects');
    expect(projectsRes.status).toBe(200);
    const projectsBody = await projectsRes.json();
    const listedProject = projectsBody.projects.find(
      (project: { id: string }) => project.id === 'flow-p1',
    ) as { id: string; environments: Array<{ type: string }> };
    expect(listedProject).toBeDefined();
    expect(listedProject.environments.some((environment) => environment.type === 'staging')).toBe(
      true,
    );
    expect(`/projects/${listedProject.id}?env=staging`).toBe('/projects/flow-p1?env=staging');

    const envExampleRes = await app.request(
      '/api/projects/flow-p1/env-example?environment=staging',
    );
    expect(envExampleRes.status).toBe(200);

    const envExample = await envExampleRes.text();
    expect(envExample).toContain('API_URL=<configured-in-openlander>');
    expect(envExample).toContain('FEATURE_FLAG=<configured-in-openlander>');
    expect(envExample).toContain('# TODO: Set SHARED_TOKEN');
    expect(envExample).toContain('SHARED_TOKEN=');
    expect(envExample).not.toContain('https://staging-api.example.com');
    expect(envExample).not.toContain('prod-token-value');

    expect(cloneRepo as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/openlander/flow-app',
        branch: 'develop',
      }),
    );
    expect(scanForEnvUsage as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });
});
