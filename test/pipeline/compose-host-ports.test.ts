import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { ComposePipeline, findComposeHostPortUsages } from '../../src/pipeline/compose.js';
import type { Docker } from '../../src/pipeline/docker.js';
import type { Database } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import type { DeployPlan } from '../../src/pipeline/deploy-plan/types.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';

describe('compose host port guard', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir.length > 0) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  function writeCompose(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-host-ports-'));
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, content, 'utf8');
    return composePath;
  }

  it('detects short and long compose ports while allowing expose', () => {
    const composePath = writeCompose(`services:
  web:
    image: nginx
    ports:
      - "3000:3000"
  api:
    image: node:22
    ports:
      - target: 8080
        published: 18080
        protocol: tcp
  db:
    image: postgres:16
    expose:
      - "5432"
`);
    const pipeline = new ComposePipeline({} as Docker, {} as Database, new EventBus());

    const parsed = pipeline.parseComposeFile(composePath);
    const dbService = parsed.services.find((service) => service.name === 'db');

    expect(findComposeHostPortUsages(parsed)).toEqual([
      { service: 'web', ports: ['3000:3000'] },
      { service: 'api', ports: ['18080:8080/tcp'] },
    ]);
    expect(dbService?.expose).toEqual(['5432']);
  });

  it('rejects compose host ports before project/container mutation', async () => {
    const composePath = writeCompose(`services:
  web:
    image: nginx
    ports:
      - "3000:3000"
`);
    const pipeline = new ComposePipeline({} as Docker, {} as Database, new EventBus());

    await expect(
      pipeline.deployCompose({
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_HOST_PORTS_UNSUPPORTED',
      details: {
        mappings: [{ service: 'web', ports: ['3000:3000'] }],
      },
    });
  });

  it('validate_deploy_plan reports compose host ports as a blocking issue', async () => {
    const plan: DeployPlan = {
      plan_id: 'plan_host_ports',
      status: 'ready',
      complexity: 'simple',
      app: {
        name: 'stack',
        source: {
          repo_url: 'https://github.com/example/stack',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      build: {
        method: 'compose',
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_file: 'docker-compose.yml',
        compose_services: [{ name: 'web', host_ports: ['3000:3000'] }],
      },
      services: [],
      secrets: [],
      env: { auto: {}, required: [], provided: {}, detected: [] },
      health: { path: '/', retries: 10, interval_ms: 2000 },
      missing: [],
      warnings: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    const validate = deployPlanToolDefs.find((tool) => tool.name === 'validate_deploy_plan');
    expect(validate).toBeDefined();

    const result = await validate!.execute(
      { plan_id: plan.plan_id },
      {
        appCtx: {
          db: {
            getDeployPlan: async () => ({ plan_json: JSON.stringify(plan) }),
          },
        } as unknown as AppContext,
        target: 'mcp',
      },
    );

    expect(result).toMatchObject({
      valid: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'compose_ports',
          status: 'fail',
          message: expect.stringContaining('Compose `ports:` host mappings are not supported'),
        }),
      ]),
    });
  });
});
