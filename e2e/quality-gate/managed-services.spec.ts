import { expect, test } from '@playwright/test';

import {
  deleteProject,
  getDeployments,
  mcpCall,
  uniqueProjectName,
  waitForServiceStatus,
} from './fixtures/api.js';

const REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const SCENARIO_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 3_000;

type McpToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseToolCallResult<T>(envelope: McpToolCallEnvelope): T {
  if (envelope.isError === true) {
    const text =
      envelope.content
        ?.map((item) => item.text)
        .filter((value): value is string => typeof value === 'string')
        .join('\n') || JSON.stringify(envelope);
    throw new Error(`MCP tool returned error: ${text}`);
  }
  expect(Array.isArray(envelope.content)).toBe(true);

  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  expect(typeof text).toBe('string');

  return JSON.parse(text as string) as T;
}

async function callTool<T>(
  name: string,
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  const envelope = (await mcpCall('tools/call', {
    name,
    arguments: { action, params },
  })) as McpToolCallEnvelope;
  return parseToolCallResult<T>(envelope);
}

async function waitForDeploymentCount(projectId: string, minimumCount: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCENARIO_TIMEOUT_MS) {
    const deployments = await getDeployments(projectId);
    if (deployments.length >= minimumCount) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${String(minimumCount)} deployments on ${projectId}`);
}

async function waitForTerminalDeployment(serviceId: string): Promise<{ deploy_id: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCENARIO_TIMEOUT_MS) {
    const status = await callTool<{
      active: number;
      jobs: Array<{ deploy_id?: string; status?: string; terminal?: boolean }>;
    }>('openlander_deploy', 'get_deploy_status', { service_id: serviceId });
    const terminalJob = status.jobs.find((job) => job.terminal === true);
    if (status.active === 0 && terminalJob?.deploy_id) {
      expect(terminalJob.status).toBe('success');
      return { deploy_id: terminalJob.deploy_id };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for terminal deployment on ${serviceId}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — RC managed service smoke', () => {
  test.skip(
    process.env.OPENLANDER_E2E_RC_SMOKE !== '1',
    'RC managed-service smoke requires a fresh/dedicated QA host; set OPENLANDER_E2E_RC_SMOKE=1.',
  );

  let projectId: string | null = null;
  let serviceId: string | null = null;
  const managedServiceNames: string[] = [];

  test.afterAll(async () => {
    for (const serviceName of [...managedServiceNames].reverse()) {
      try {
        await callTool('openlander_managed_service', 'remove_service', {
          service_name: serviceName,
          force: true,
        });
      } catch (error) {
        console.warn(`Failed to remove managed service ${serviceName}:`, error);
      }
    }

    if (!projectId) return;
    try {
      await deleteProject(projectId);
    } catch (error) {
      console.warn(`Failed to delete project ${projectId}:`, error);
    }
  });

  test('deploys through MCP, creates PostgreSQL/Redis, redeploys, and reads topology/logs', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const suffix = Date.now().toString(36);
    const projectName = uniqueProjectName('qg-rc-smoke');
    const postgresName = `qg-pg-${suffix}`;
    const redisName = `qg-redis-${suffix}`;

    const initializeResult = (await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'quality-gate-rc-smoke', version: '1.0.0' },
    })) as { protocolVersion?: string };
    expect(initializeResult.protocolVersion).toBeTruthy();

    const createPlan = await callTool<{ plan_id: string; status: string }>(
      'openlander_deploy',
      'create_deploy_plan',
      { repo_url: REPO_URL, branch: 'main', name: projectName },
    );
    expect(createPlan.status).toBe('ready');

    const executeResult = await callTool<{
      status: string;
      project_id?: string;
      project_name?: string;
    }>('openlander_deploy', 'execute_deploy_plan', { plan_id: createPlan.plan_id });
    expect(executeResult.status).toBe('building');
    expect(executeResult.project_id).toBeTruthy();
    projectId = executeResult.project_id ?? null;

    const runningService = await waitForServiceStatus(projectId as string, 'running', 180_000);
    serviceId = runningService.id;
    expect(serviceId).toBeTruthy();

    const postgres = await callTool<{
      status: string;
      service: { id: string; name: string; type: string; status: string };
      auto_injected_env_keys?: string[];
    }>('openlander_managed_service', 'create_service', {
      name: postgresName,
      template: 'postgresql',
      project_id: projectId,
    });
    expect(postgres.status).toBe('created');
    expect(postgres.service.type).toBe('postgresql');
    expect(postgres.auto_injected_env_keys ?? []).toContain('DATABASE_URL');
    managedServiceNames.push(postgres.service.name);

    const redis = await callTool<{
      status: string;
      service: { id: string; name: string; type: string; status: string };
      auto_injected_env_keys?: string[];
    }>('openlander_managed_service', 'create_service', {
      name: redisName,
      template: 'redis',
      project_id: projectId,
    });
    expect(redis.status).toBe('created');
    expect(redis.service.type).toBe('redis');
    expect(redis.auto_injected_env_keys ?? []).toContain('REDIS_URL');
    managedServiceNames.push(redis.service.name);

    const postgresStatus = await callTool<{ status: string; health: string }>(
      'openlander_managed_service',
      'get_service_status',
      { service_id: postgres.service.id },
    );
    expect(postgresStatus.status).toBe('running');

    const redisStatus = await callTool<{ status: string; health: string }>(
      'openlander_managed_service',
      'get_service_status',
      { service_id: redis.service.id },
    );
    expect(redisStatus.status).toBe('running');

    const beforeRedeploy = await getDeployments(projectId as string);
    const redeploy = await callTool<{ status: string }>('openlander_service', 'redeploy_app', {
      service_id: serviceId,
      strategy: 'force',
    });
    expect(redeploy.status).toBe('deploying');

    await waitForDeploymentCount(projectId as string, beforeRedeploy.length + 1);
    const terminalDeployment = await waitForTerminalDeployment(serviceId as string);
    await waitForServiceStatus(projectId as string, 'running', 180_000);

    const topology = await callTool<{
      count: number;
      services: Array<{
        id: string;
        role: 'deployable' | 'managed';
        type?: string;
        dependsOn: string[];
      }>;
      edges: Array<{ from: string; to: string }>;
    }>('openlander_monitor', 'get_topology', { project_id: projectId });

    expect(topology.services.some((service) => service.id === postgres.service.id)).toBe(true);
    expect(topology.services.some((service) => service.id === redis.service.id)).toBe(true);
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: serviceId, to: postgres.service.id }),
        expect.objectContaining({ from: serviceId, to: redis.service.id }),
      ]),
    );

    const diagnosis = await callTool<{ service: { id: string }; status?: string }>(
      'openlander_monitor',
      'diagnose_service',
      { service_id: serviceId },
    );
    expect(diagnosis.service.id).toBe(serviceId);

    const buildLog = await callTool<{ status: string; full_log: boolean; truncated: boolean }>(
      'openlander_deploy',
      'get_build_log',
      { deploy_id: terminalDeployment.deploy_id },
    );
    expect(buildLog.status).toBe('success');
    expect(buildLog.full_log).toBe(true);
    expect(buildLog.truncated).toBe(false);
  });
});
