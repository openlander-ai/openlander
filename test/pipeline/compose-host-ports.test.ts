import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app.js';
import {
  ComposePipeline,
  findComposeHostPortUsages,
  interpolateComposeValue,
  selectComposeServices,
} from '../../src/pipeline/compose.js';
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

  it('preserves long-form dependency conditions', () => {
    const composePath = writeCompose(`services:
  db:
    image: postgres:16
  migrate:
    image: app
    depends_on:
      db:
        condition: service_healthy
  api:
    image: app
    depends_on:
      migrate:
        condition: service_completed_successfully
`);
    const pipeline = new ComposePipeline({} as Docker, {} as Database, new EventBus());
    const parsed = pipeline.parseComposeFile(composePath);

    expect(parsed.services.find((service) => service.name === 'migrate')).toMatchObject({
      dependsOn: ['db'],
      dependsOnConditions: { db: 'service_healthy' },
    });
    expect(parsed.services.find((service) => service.name === 'api')).toMatchObject({
      dependsOn: ['migrate'],
      dependsOnConditions: { migrate: 'service_completed_successfully' },
    });
  });

  it('resolves compose interpolation defaults and required values', () => {
    expect(interpolateComposeValue('${PORT:-3000}:3000', {})).toBe('3000:3000');
    expect(interpolateComposeValue('${PORT:-3000}:3000', { PORT: '8080' })).toBe('8080:3000');
    expect(interpolateComposeValue('$${UNCHANGED}', {})).toBe('${UNCHANGED}');
    expect(() => interpolateComposeValue('${API_KEY:?Set API_KEY}', {})).toThrow('Set API_KEY');
  });

  it('includes transitive dependencies when specific services are selected', () => {
    const selected = selectComposeServices(
      [
        { name: 'db' },
        { name: 'migrate', dependsOn: ['db'] },
        { name: 'api', dependsOn: ['db', 'migrate'] },
        { name: 'web', dependsOn: ['api'] },
        { name: 'testdb' },
      ],
      ['web'],
    );

    expect(selected.map((service) => service.name)).toEqual(['db', 'migrate', 'api', 'web']);
    expect(() => selectComposeServices(selected, ['missing'])).toThrow(
      'Unknown Compose service(s): missing',
    );
  });

  it('validate_deploy_plan reports compose host ports as informational', async () => {
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
      valid: true,
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'compose_ports',
          status: 'info',
          message: expect.stringContaining('OpenLander ports'),
        }),
      ]),
    });
  });

  it('validate_deploy_plan reports untrusted external env as a blocking issue', async () => {
    const plan: DeployPlan = {
      plan_id: 'plan_untrusted_external_env',
      status: 'needs_input',
      complexity: 'simple',
      app: {
        name: 'ledgerly',
        source: {
          repo_url: 'https://github.com/openlander-ai/ledgerly',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
      },
      services: [],
      secrets: [],
      env: {
        auto: {},
        required: ['EXCHANGE_API_URL'],
        provided: { EXCHANGE_API_URL: 'https://api.blockchain.com' },
        detected: [
          {
            key: 'EXCHANGE_API_URL',
            source: 'config schema',
            required: true,
            requirement: { kind: 'url', source: 'schema' },
          },
        ],
      },
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
          name: 'env_vars',
          status: 'fail',
          message: expect.stringContaining('user-owned external configuration'),
        }),
      ]),
    });
  });
});
