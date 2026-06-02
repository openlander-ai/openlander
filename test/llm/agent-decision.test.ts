import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LanguageModel, ToolSet } from 'ai';
import type { Database } from '../../src/db/index.js';
import type { ApprovalGate, ApprovalResult } from '../../src/pipeline/approval-gate.js';
import type { ChatStreamEvent } from '../../src/types/agent-events.js';
import { Agent } from '../../src/llm/agent.js';

const { streamTextMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: streamTextMock,
  stepCountIs: vi.fn((steps: number) => steps),
}));

interface ScenarioState {
  toolName: string;
  args: Record<string, unknown>;
  finalText: string;
}

const scenario: ScenarioState = {
  toolName: 'list_projects',
  args: {},
  finalText: 'done',
};

function setupStreamTextMock(): void {
  streamTextMock.mockImplementation(({ tools }: { tools: ToolSet }) => {
    const execute = tools[scenario.toolName]?.execute as
      | ((
          input: Record<string, unknown>,
          options: { toolCallId: string; messages: unknown[] },
        ) => unknown | Promise<unknown>)
      | undefined;

    const fullStream = async function* () {
      yield {
        type: 'tool-call',
        toolName: scenario.toolName,
        input: scenario.args,
      };

      const output = execute
        ? await execute(scenario.args, { toolCallId: 'tc-1', messages: [] })
        : null;
      yield {
        type: 'tool-result',
        toolName: scenario.toolName,
        output,
      };

      yield { type: 'finish-step' };
      yield { type: 'text-delta', text: scenario.finalText };
    };

    return {
      fullStream: fullStream(),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
    };
  });
}

function createMockDb(): Database {
  const mockDb = {
    createActionRun: vi.fn().mockReturnValue('action-run-1'),
    updateActionRunStatus: vi.fn(),
    updateActionRunApproval: vi.fn(),
    createAiUsageLog: vi.fn().mockReturnValue('usage-1'),
    getProject: vi.fn(),
    getProjectByName: vi.fn(),
    getService: vi.fn(),
    getDeployableForProject: vi.fn(),
    getEnvironmentsByProject: vi.fn(),
    getManagedServicesByGroup: vi.fn().mockResolvedValue([]),
  };
  return mockDb as unknown as Database;
}

function getMockDb(db: Database) {
  return db as unknown as {
    getProject: ReturnType<typeof vi.fn>;
    getProjectByName: ReturnType<typeof vi.fn>;
    getService: ReturnType<typeof vi.fn>;
    getDeployableForProject: ReturnType<typeof vi.fn>;
    getEnvironmentsByProject: ReturnType<typeof vi.fn>;
    getManagedServicesByGroup: ReturnType<typeof vi.fn>;
  };
}

function createApprovalGate(result: ApprovalResult = 'approved'): ApprovalGate {
  const approvalGate = {
    waitForApproval:
      vi.fn<
        (
          actionRunId: string,
          metadata: Parameters<ApprovalGate['waitForApproval']>[1],
        ) => Promise<ApprovalResult>
      >(),
  } as unknown as ApprovalGate;
  vi.mocked(approvalGate.waitForApproval).mockResolvedValue(result);
  return approvalGate;
}

function createAgentWithTools(
  db: Database,
  approvalGate?: ApprovalGate,
): { agent: Agent; toolExecuteMock: ReturnType<typeof vi.fn> } {
  const model = { modelId: 'test-model' } as unknown as LanguageModel;
  const agent = new Agent(model, db, undefined, 'gemini', 'en', 'web_agent', approvalGate);

  const toolExecuteMock = vi.fn(async () => ({ ok: true }));
  const tools = {
    list_projects: { execute: toolExecuteMock },
    deploy_app: { execute: toolExecuteMock },
    rollback_service: { execute: toolExecuteMock },
    archive_project: { execute: toolExecuteMock },
    archive_service: { execute: toolExecuteMock },
  } as unknown as ToolSet;

  agent.setTools(tools);
  return { agent, toolExecuteMock };
}

describe('Agent DecisionEngine integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStreamTextMock();
    scenario.args = {};
    scenario.finalText = 'Finished';
  });

  it('executes low-risk tool without notification event', async () => {
    scenario.toolName = 'list_projects';

    const db = createMockDb();
    const { agent, toolExecuteMock } = createAgentWithTools(db);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'show projects',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'notification')).toBe(false);
  });

  it('emits notification and executes for medium-risk tool', async () => {
    scenario.toolName = 'deploy_app';
    scenario.args = { project_id: 'proj-1' };

    const db = createMockDb();
    const { agent, toolExecuteMock } = createAgentWithTools(db);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'deploy project',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) =>
          event.type === 'notification' &&
          event.toolName === 'deploy_app' &&
          event.message.includes('Executing deploy_app'),
      ),
    ).toBe(true);
  });

  it('emits approval_required and executes high-risk tool after approval', async () => {
    scenario.toolName = 'rollback_service';
    scenario.args = { project_id: 'proj-1', project_name: 'proj-name' };

    const db = createMockDb();
    const approvalGate = createApprovalGate('approved');

    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'rollback now',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(true);
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(approvalGate.waitForApproval)).toHaveBeenCalledTimes(1);
  });

  it('emits approval_required and returns rejection result for high-risk rejection', async () => {
    scenario.toolName = 'rollback_service';
    scenario.args = { project_id: 'proj-1', project_name: 'proj-name' };

    const db = createMockDb();
    const approvalGate = createApprovalGate('rejected');

    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'rollback now',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(true);
    expect(toolExecuteMock).not.toHaveBeenCalled();

    const rejectionEvent = events.find(
      (event) =>
        event.type === 'tool_result' &&
        event.toolName === 'rollback_service' &&
        typeof event.result === 'object' &&
        event.result !== null,
    );

    expect(rejectionEvent).toBeDefined();
    if (rejectionEvent?.type === 'tool_result') {
      expect(rejectionEvent.result).toEqual({
        error: 'ACTION_REJECTED',
        message: 'User rejected the action',
      });
    }
  });

  it('archives stopped or non-production project without approval and emits notification', async () => {
    scenario.toolName = 'archive_project';
    scenario.args = { project_name: 'dev-app' };

    const db = createMockDb();
    const mockDb = getMockDb(db);
    mockDb.getProjectByName.mockResolvedValue({ id: 'proj-dev', name: 'dev-app' });
    mockDb.getDeployableForProject.mockResolvedValue({ status: 'stopped' });
    mockDb.getEnvironmentsByProject.mockResolvedValue([
      { type: 'production', status: 'stopped' },
      { type: 'development', status: 'running' },
    ]);
    mockDb.getManagedServicesByGroup.mockResolvedValue([{ status: 'stopped' }]);
    const approvalGate = createApprovalGate('approved');
    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'archive dev app',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'notification' &&
          event.toolName === 'archive_project' &&
          event.message.includes('Executing archive_project'),
      ),
    ).toBe(true);
    expect(vi.mocked(approvalGate.waitForApproval)).not.toHaveBeenCalled();
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('requires approval before archiving running production project', async () => {
    scenario.toolName = 'archive_project';
    scenario.args = { project_name: 'prod-app' };

    const db = createMockDb();
    const mockDb = getMockDb(db);
    mockDb.getProjectByName.mockResolvedValue({ id: 'proj-prod', name: 'prod-app' });
    mockDb.getDeployableForProject.mockResolvedValue({ status: 'running' });
    mockDb.getEnvironmentsByProject.mockResolvedValue([{ type: 'production', status: 'running' }]);
    const approvalGate = createApprovalGate('approved');
    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'archive production app',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(true);
    expect(vi.mocked(approvalGate.waitForApproval)).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('requires approval to archive a project whose app is stopped but a managed resource is running', async () => {
    scenario.toolName = 'archive_project';
    scenario.args = { project_name: 'data-app' };

    const db = createMockDb();
    const mockDb = getMockDb(db);
    mockDb.getProjectByName.mockResolvedValue({ id: 'proj-data', name: 'data-app' });
    mockDb.getDeployableForProject.mockResolvedValue({ status: 'stopped' });
    mockDb.getEnvironmentsByProject.mockResolvedValue([{ type: 'production', status: 'stopped' }]);
    // App is stopped, but a managed database is still running with data.
    mockDb.getManagedServicesByGroup.mockResolvedValue([{ status: 'running' }]);
    const approvalGate = createApprovalGate('approved');
    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'archive the data app',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(true);
    expect(vi.mocked(approvalGate.waitForApproval)).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('requires approval when archive target project cannot be resolved (fail-safe)', async () => {
    scenario.toolName = 'archive_project';
    scenario.args = { project_name: 'ghost-app' };

    const db = createMockDb();
    const mockDb = getMockDb(db);
    mockDb.getProjectByName.mockResolvedValue(undefined);
    const approvalGate = createApprovalGate('approved');
    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'archive ghost app',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(true);
    expect(vi.mocked(approvalGate.waitForApproval)).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('archives a stopped service without approval and emits notification', async () => {
    scenario.toolName = 'archive_service';
    scenario.args = { service_id: 'svc-1' };

    const db = createMockDb();
    const mockDb = getMockDb(db);
    mockDb.getService.mockResolvedValue({ id: 'svc-1', status: 'stopped' });
    const approvalGate = createApprovalGate('approved');
    const { agent, toolExecuteMock } = createAgentWithTools(db, approvalGate);
    const events: ChatStreamEvent[] = [];

    await agent.chatStream(
      'archive stopped service',
      async (event) => {
        events.push(event);
      },
      'session-1',
    );

    expect(events.some((event) => event.type === 'approval_required')).toBe(false);
    expect(vi.mocked(approvalGate.waitForApproval)).not.toHaveBeenCalled();
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
  });
});
