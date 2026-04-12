import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { generateEnvExample } from '../src/pipeline/env-inject.js';
import { cloneRepo } from '../src/pipeline/git.js';
import { createProjectRoutes } from '../src/web/api/project-routes.js';
import { scanForEnvUsage } from '../src/pipeline/env-scan.js';
import { createMockContext } from './helpers/web-route-mocks.js';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/mock-clone', commitSha: 'deadbeef' }),
}));

vi.mock('../src/pipeline/env-scan.js', () => ({
  scanForEnvUsage: vi.fn().mockReturnValue({
    vars: [
      { key: 'API_KEY', files: [{ path: 'src/app.ts', line: 5 }], optional: false },
      { key: 'APP_ORIGIN', files: [{ path: 'src/app.ts', line: 8 }], optional: false },
      { key: 'FEATURE_FLAG', files: [{ path: 'src/config.ts', line: 3 }], optional: false },
    ],
    hasEnvExample: false,
    language: 'node',
    serviceHints: ['redis'],
  }),
}));

describe('generateEnvExample', () => {
  it('includes scan keys and service-derived keys without leaking raw values', () => {
    const text = generateEnvExample(
      {
        vars: [
          { key: 'API_KEY', files: [{ path: 'src/app.ts', line: 3 }], optional: false },
          { key: 'APP_ORIGIN', files: [{ path: 'src/app.ts', line: 6 }], optional: false },
        ],
        hasEnvExample: false,
        language: 'node',
        serviceHints: ['redis'],
      },
      {
        API_KEY: 'super-secret-token',
        APP_ORIGIN: 'https://prod.example.com',
      },
    );

    expect(text).toContain('API_KEY=');
    expect(text).toContain('APP_ORIGIN=<configured-in-openlander>');
    expect(text).toContain('REDIS_URL=redis://redis:6379');
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('https://prod.example.com');
  });
});

describe('GET /api/projects/:id/env-example', () => {
  let app: Hono;
  let db: Database;
  let tmp: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'env-example-route-'));
    db = new Database(join(tmp, 'test.db'));
    ctx = createMockContext(db);
    app = new Hono();
    app.route('/api', createProjectRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns generated env-example text', async () => {
    db.createProject({ id: 'p1', name: 'demo', repoUrl: 'https://github.com/openlander/demo' });
    const productionEnvironment = db
      .getEnvironmentsByProject('p1')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const getAllWithInheritance = vi.fn(
      (projectId: string, environmentId: string): Record<string, string> => {
        expect(projectId).toBe('p1');
        if (environmentId === productionEnvironment!.id) {
          return {
            API_KEY: 'prod-secret-value',
            APP_ORIGIN: 'https://prod.example.com',
          };
        }
        return {};
      },
    );
    (
      ctx.env as unknown as { getAllWithInheritance: typeof getAllWithInheritance }
    ).getAllWithInheritance = getAllWithInheritance;

    const productionRes = await app.request('/api/projects/p1/env-example');

    expect(productionRes.status).toBe(200);

    const productionBody = await productionRes.text();

    expect(productionBody).toContain('FEATURE_FLAG=');
    expect(productionBody).toContain('REDIS_URL=redis://redis:6379');

    expect(productionBody).not.toContain('prod-secret-value');
    expect(productionBody).not.toContain('https://prod.example.com');

    const mockedCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;
    expect(mockedCloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({ branch: productionEnvironment!.branch }),
    );

    const mockedScan = scanForEnvUsage as unknown as ReturnType<typeof vi.fn>;
    expect(mockedScan).toHaveBeenCalledTimes(1);
  });
});
