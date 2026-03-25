import { expect, test } from '@playwright/test';

import { deleteProject, getProject, mcpCall } from './fixtures/api.js';

const REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

type McpToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseToolCallResult<T>(envelope: McpToolCallEnvelope): T {
  expect(envelope.isError).not.toBe(true);
  expect(Array.isArray(envelope.content)).toBe(true);

  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  expect(typeof text).toBe('string');

  return JSON.parse(text as string) as T;
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — MCP HTTP Deploy E2E', () => {
  let projectId: string | null = null;

  test.afterAll(async () => {
    if (!projectId) return;

    try {
      await deleteProject(projectId);
    } catch (error) {
      console.warn(`Failed to delete project ${projectId}:`, error);
    }
  });

  test('initialize + create_deploy_plan + execute_deploy_plan + status polling reaches running', async () => {
    test.setTimeout(240_000);

    const initializeResult = (await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    })) as { protocolVersion?: string };

    expect(initializeResult.protocolVersion).toBeTruthy();

    const createPlanEnvelope = (await mcpCall('tools/call', {
      name: 'create_deploy_plan',
      arguments: { repo_url: REPO_URL },
    })) as McpToolCallEnvelope;

    const createPlan = parseToolCallResult<{ plan_id: string; status: string }>(createPlanEnvelope);
    expect(createPlan.plan_id).toBeTruthy();
    expect(['ready', 'needs_input']).toContain(createPlan.status);
    expect(createPlan.status).toBe('ready');

    const executeEnvelope = (await mcpCall('tools/call', {
      name: 'execute_deploy_plan',
      arguments: { plan_id: createPlan.plan_id },
    })) as McpToolCallEnvelope;

    const executeResult = parseToolCallResult<{
      status: string;
      project_id?: string;
      project_name?: string;
      error?: string;
    }>(executeEnvelope);

    expect(executeResult.status).toBe('building');
    expect(executeResult.project_id).toBeTruthy();
    projectId = executeResult.project_id ?? null;

    const start = Date.now();
    let lastPhase = 'unknown';
    let lastProjectStatus = 'unknown';

    while (Date.now() - start < POLL_TIMEOUT_MS) {
      const statusEnvelope = (await mcpCall('tools/call', {
        name: 'get_deploy_status',
        arguments: { project_id: projectId },
      })) as McpToolCallEnvelope;

      const statusResult = parseToolCallResult<{
        active: number;
        jobs: Array<{ name: string; phase: string; error?: string }>;
      }>(statusEnvelope);

      if (statusResult.jobs.length > 0) {
        lastPhase = statusResult.jobs[0]?.phase ?? lastPhase;
      }

      if (statusResult.jobs.some((job) => job.phase === 'failed')) {
        throw new Error(`Deploy failed during polling (phase=${lastPhase})`);
      }

      const project = await getProject(projectId as string);
      lastProjectStatus = String(project.status ?? 'unknown');

      if (project.status === 'running') {
        break;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const finalProject = await getProject(projectId as string);
    expect(finalProject.status).toBe('running');
    expect(finalProject.container_id).toBeTruthy();
    expect(typeof finalProject.assigned_port).toBe('number');

    if (finalProject.status !== 'running') {
      throw new Error(
        `Timed out waiting for running state (phase=${lastPhase}, projectStatus=${lastProjectStatus})`,
      );
    }
  });
});
