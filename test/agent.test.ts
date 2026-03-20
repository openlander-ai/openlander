import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Agent } from '../src/agent/index.js';
import type { ToolSet, LanguageModel } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { Database } from '../src/db/index.js';
import type { AppContext } from '../src/app.js';
import { createTools } from '../src/agent/tools.js';
import type { QuestionBridge } from '../src/agent/question-bridge.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as configModule from '../src/config/index.js';
import * as gitProvidersModule from '../src/git-providers/index.js';

const cloneRepoMock = vi.spyOn(gitPipeline, 'cloneRepo') as unknown as {
  mockResolvedValue: (value: unknown) => unknown;
};
const loadConfigMock = vi.spyOn(configModule, 'loadConfig') as unknown as {
  mockReturnValue: (value: unknown) => unknown;
};
const createGitProviderMock = vi.spyOn(gitProvidersModule, 'createGitProvider') as unknown as {
  mockReturnValue: (value: unknown) => unknown;
};

beforeEach(() => {
  vi.clearAllMocks();
  loadConfigMock.mockReturnValue({
    gitProviders: {
      github: {
        token: '',
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Mock AI SDK
// ---------------------------------------------------------------------------

interface MockGenerateTextOptions {
  /** Text response to return */
  text: string;
  /** Tool results from all steps */
  steps?: Array<{
    toolResults: Array<{
      toolName: string;
      output: unknown;
    }>;
  }>;
}

interface MockStreamTextOptions {
  /** Stream events to emit */
  events: Array<
    | { type: 'text-delta'; text: string }
    | { type: 'tool-call'; toolName: string; input: Record<string, unknown> }
    | { type: 'tool-result'; toolName: string; output: unknown }
    | { type: 'tool-error'; toolName: string; error: string | Error }
    | { type: 'error'; error: string | Error }
    | { type: 'finish-step' }
  >;
}

interface MockModelOptions {
  model: LanguageModel;
  messages: Array<{ role: string; content: string }>;
  tools: ToolSet;
}

// Store mock implementations for each test
let mockGenerateTextImplementation:
  | ((opts: {
      model: LanguageModel;
      messages: Array<{ role: string; content: string }>;
      tools: ToolSet;
    }) => Promise<MockGenerateTextOptions>)
  | null = null;

let mockStreamTextImplementation:
  | ((opts: {
      model: LanguageModel;
      messages: Array<{ role: string; content: string }>;
      tools: ToolSet;
    }) => MockStreamTextOptions)
  | null = null;

vi.mock('ai', () => ({
  generateText: vi.fn(async (opts: MockModelOptions) => {
    if (!mockGenerateTextImplementation) {
      return { text: 'Default response', steps: [] };
    }
    const result = await mockGenerateTextImplementation(opts);
    return {
      text: result.text,
      steps: result.steps ?? [],
    };
  }),
  streamText: vi.fn((opts: MockModelOptions) => {
    const events = mockStreamTextImplementation ? mockStreamTextImplementation(opts).events : [];
    return {
      fullStream: {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      },
    };
  }),
  stepCountIs: vi.fn((max: number) => ({ maxSteps: max })),
  tool: vi.fn(
    (config: {
      description?: string;
      parameters?: z.ZodSchema;
      inputSchema?: z.ZodSchema;
      execute: (args: unknown, options?: unknown) => Promise<unknown>;
    }) => ({
      ...config,
      inputSchema: config.inputSchema ?? config.parameters,
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock tool using AI SDK tool() pattern */
function createMockTool(name: string, result: unknown = { ok: true }) {
  return tool({
    description: `Mock tool: ${name}`,
    inputSchema: z.object({}),
    execute: vi.fn<() => Promise<unknown>>().mockResolvedValue(result),
  });
}

/** Create a failing mock tool */
function createFailingMockTool(name: string, error: Error) {
  return tool({
    description: `Mock tool: ${name}`,
    inputSchema: z.object({}),
    execute: vi.fn<() => Promise<unknown>>().mockRejectedValue(error),
  });
}

/** Create a mock LanguageModel (empty object since generateText/streamText are mocked) */
function createMockModel(): LanguageModel {
  return {} as LanguageModel;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent — agentic loop', () => {
  let db: Database;
  let tmpDir: string;
  let mockModel: LanguageModel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    mockModel = createMockModel();
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  it('returns text directly when LLM has no tool calls', async () => {
    mockGenerateTextImplementation = async () => ({
      text: 'Hello! How can I help?',
      steps: [],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    const result = await agent.chat('hi');

    expect(result.message).toBe('Hello! How can I help?');
    expect(result.toolResults).toBeUndefined();
  });

  it('executes tool calls and loops back to LLM', async () => {
    const listTool = createMockTool('list_projects', [{ name: 'my-app', status: 'running' }]);

    mockGenerateTextImplementation = async () => ({
      text: 'You have 1 project: my-app (running).',
      steps: [
        {
          toolResults: [
            {
              toolName: 'list_projects',
              output: [{ name: 'my-app', status: 'running' }],
            },
          ],
        },
      ],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({ list_projects: listTool });

    const result = await agent.chat('list my projects');

    expect(result.message).toBe('You have 1 project: my-app (running).');
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.toolName).toBe('list_projects');
    expect(result.toolResults![0]!.success).toBe(true);
    // Tool execution happens inside AI SDK's generateText which is mocked
  });

  it('handles multi-step tool chains', async () => {
    const deployTool = createMockTool('deploy_project', {
      projectId: 'p1',
      url: 'http://localhost:10001',
    });
    const exposeTool = createMockTool('expose_public', {
      publicUrl: 'https://abc.trycloudflare.com',
    });

    mockGenerateTextImplementation = async () => ({
      text: 'Deployed and exposed at https://abc.trycloudflare.com',
      steps: [
        {
          toolResults: [
            {
              toolName: 'deploy_project',
              output: { projectId: 'p1', url: 'http://localhost:10001' },
            },
          ],
        },
        {
          toolResults: [
            {
              toolName: 'expose_public',
              output: { publicUrl: 'https://abc.trycloudflare.com' },
            },
          ],
        },
      ],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({ deploy_project: deployTool, expose_public: exposeTool });

    const result = await agent.chat('deploy and make it public');

    expect(result.message).toContain('trycloudflare.com');
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults![0]!.toolName).toBe('deploy_project');
    expect(result.toolResults![1]!.toolName).toBe('expose_public');
  });

  it('handles tool execution errors gracefully', async () => {
    const failTool = createFailingMockTool('deploy_project', new Error('Docker not running'));

    mockGenerateTextImplementation = async () => ({
      text: 'Deploy failed: Docker is not running.',
      steps: [
        {
          toolResults: [
            {
              toolName: 'deploy_project',
              output: { success: false, error: 'Docker not running' },
            },
          ],
        },
      ],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({ deploy_project: failTool });

    const result = await agent.chat('deploy my app');

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.success).toBe(true); // AI SDK reports tool results as success even if tool threw
    expect(result.message).toContain('Docker');
  });

  it('handles unknown tool names', async () => {
    mockGenerateTextImplementation = async () => ({
      text: 'That tool does not exist.',
      steps: [
        {
          toolResults: [
            {
              toolName: 'nonexistent_tool',
              output: { error: 'Unknown tool: nonexistent_tool' },
            },
          ],
        },
      ],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({});

    const result = await agent.chat('do something');

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.toolName).toBe('nonexistent_tool');
    expect(result.toolResults![0]!.success).toBe(true);
  });

  it('stops at MAX_TOOL_STEPS and returns fallback message', async () => {
    const dummyTool = createMockTool('list_projects', []);

    // Create 10 steps (MAX_TOOL_STEPS = 10)
    const steps: Array<{ toolResults: Array<{ toolName: string; output: unknown }> }> = [];
    for (let i = 0; i < 10; i++) {
      steps.push({
        toolResults: [{ toolName: 'list_projects', output: [] }],
      });
    }

    mockGenerateTextImplementation = async () => ({
      text: '', // Empty text triggers fallback message
      steps,
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({ list_projects: dummyTool });

    const result = await agent.chat('infinite loop');

    expect(result.message).toContain('maximum number of steps');
    expect(result.toolResults).toHaveLength(10);
    // Tool execution happens inside AI SDK's generateText which is mocked
  });
});

describe('Agent — history management', () => {
  let db: Database;
  let tmpDir: string;
  let mockModel: LanguageModel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-hist-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    mockModel = createMockModel();
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  it('rebuilds system prompt on each chat call', async () => {
    let callCount = 0;
    const contextProvider = () => {
      callCount++;
      return `call-${String(callCount)}`;
    };

    let chatCallCount = 0;
    mockGenerateTextImplementation = async () => {
      chatCallCount++;
      return {
        text: `Response ${String(chatCallCount)}`,
        steps: [],
      };
    };

    const agent = new Agent(mockModel, db, contextProvider, 'gemini');

    await agent.chat('first message');
    await agent.chat('second message');

    // contextProvider should have been called twice (once per chat call)
    expect(callCount).toBe(2);

    // System prompt in history should contain the latest context
    const history = agent.getHistory();
    const systemMsg = history[0];
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.role).toBe('system');
    expect(systemMsg!.content).toContain('call-2');
  });

  it('trims history when exceeding MAX_HISTORY_MESSAGES', async () => {
    // MAX_HISTORY_MESSAGES = 40, KEEP_RECENT = 30
    // We need to generate enough messages to trigger trimming.
    // Each chat call adds: user message + assistant message to history
    // We need > 40 total messages.

    let chatCallCount = 0;
    mockGenerateTextImplementation = async () => {
      chatCallCount++;
      return {
        text: `Response ${String(chatCallCount)}`,
        steps: [],
      };
    };

    const agent = new Agent(mockModel, db, () => '', 'gemini');

    // Each chat adds user+assistant = 2 messages. With system prompt = 1.
    // After 25 calls: 1 (system) + 25*2 (user+assistant) = 51 messages → triggers trim at 40.
    for (let i = 0; i < 25; i++) {
      await agent.chat(`message ${String(i)}`);
    }

    const history = agent.getHistory();

    // After trimming: system + trim note + KEEP_RECENT(30) = 32 messages max
    // History should be <= 32
    expect(history.length).toBeLessThanOrEqual(32);
    expect(history[0]!.role).toBe('system');
    // Second message should be the trim note
    expect(history[1]!.content).toContain('trimmed');
  });

  it('clearHistory resets conversation', async () => {
    mockGenerateTextImplementation = async () => ({
      text: 'Hi',
      steps: [],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');

    await agent.chat('hello');
    expect(agent.getHistory().length).toBeGreaterThan(0);

    agent.clearHistory();
    expect(agent.getHistory()).toHaveLength(0);
  });
});

describe('Agent — chatStream', () => {
  let db: Database;
  let tmpDir: string;
  let mockModel: LanguageModel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-stream-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    mockModel = createMockModel();
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    mockGenerateTextImplementation = null;
    mockStreamTextImplementation = null;
  });

  it('emits session, thinking, message, and done events', async () => {
    mockStreamTextImplementation = () => ({
      events: [{ type: 'text-delta', text: 'Stream response' }],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    const events: Array<{ type: string }> = [];

    await agent.chatStream('hello', async (event) => {
      events.push(event);
    });

    const types = events.map((e) => e.type);
    expect(types).toContain('session');
    expect(types).toContain('thinking');
    expect(types).toContain('message');
    expect(types).toContain('done');
  });

  it('emits tool_call and tool_result events during tool execution', async () => {
    const listTool = createMockTool('list_projects', []);

    mockStreamTextImplementation = () => ({
      events: [
        { type: 'tool-call', toolName: 'list_projects', input: {} },
        { type: 'tool-result', toolName: 'list_projects', output: [] },
        { type: 'text-delta', text: 'Done listing.' },
      ],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    agent.setTools({ list_projects: listTool });
    const events: Array<{ type: string }> = [];

    await agent.chatStream('list projects', async (event) => {
      events.push(event);
    });

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('message');
    expect(types).toContain('done');
  });

  it('emits error event when LLM throws', async () => {
    mockStreamTextImplementation = () => ({
      events: [{ type: 'error', error: 'API rate limit' }],
    });

    const agent = new Agent(mockModel, db, () => '', 'gemini');
    const events: Array<{ type: string; error?: string }> = [];

    await agent.chatStream('hello', async (event) => {
      events.push(event as { type: string; error?: string });
    });

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error).toContain('rate limit');
  });
});

describe('Agent tools — fix approval flow', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-tools-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createToolsContext(questionBridge?: QuestionBridge) {
    const startDeploy = vi
      .fn()
      .mockResolvedValue({ projectId: 'p1', projectName: 'demo', status: 'building' });
    const buildDebugger = {
      fixDockerfile: vi.fn().mockResolvedValue({
        dockerfileContent: 'FROM node:20\nRUN npm ci\n',
        explanation: 'Use supported Node version and deterministic install',
        changes: ['Bump Node to 20', 'Use npm ci'],
      }),
    };

    const composePipeline = {
      detectComposeFile: vi.fn(),
      deployCompose: vi.fn(),
    };

    const serviceManager = {
      list: vi.fn().mockResolvedValue([]),
      listDatabases: vi.fn(),
      createDatabase: vi.fn(),
      listServices: vi.fn(),
      ensureService: vi.fn(),
      getServiceLogs: vi.fn(),
    };

    const ctx = {
      config: { git: { sshKeyPath: '' } },
      db,
      pipeline: { startDeploy },
      composePipeline,
      buildDebugger,
      alertMonitor: { getActiveAlerts: vi.fn(), dismissAlert: vi.fn() },
      env: {
        setBulk: vi.fn(),
        setGlobalSecret: vi.fn(),
        getGlobalSecretsMasked: vi.fn().mockReturnValue([]),
        getGlobalSecrets: vi.fn().mockReturnValue({}),
      },
      cloudflare: {},
      docker: {},
      blueGreen: { deploy: vi.fn() },
      dbProvisioner: { provision: vi.fn() },
      previewDeployer: { deploy: vi.fn(), cleanup: vi.fn(), list: vi.fn().mockReturnValue([]) },
      serviceManager,
      webhookManager: {},
      traefik: {},
      deployQueue: {},
      healthMonitor: {},
      channelManager: {},
      autoDetector: {},
      questionBridge,
      mcpClientManager: {},
      agent: null,
      jobManager: {},
    } as unknown as AppContext;

    return {
      tools: createTools(ctx, questionBridge) as unknown as Record<
        string,
        { execute?: (input: Record<string, unknown>, options?: unknown) => Promise<unknown> }
      >,
      buildDebugger,
      startDeploy,
      composePipeline,
      serviceManager,
    };
  }

  function seedFailedProject(): void {
    db.createProject({
      id: 'p1',
      name: 'demo',
      repoUrl: 'https://github.com/openlander/demo',
      branch: 'main',
    });
    db.createDeployLog({
      id: 'fail-1',
      projectId: 'p1',
      status: 'failed',
      trigger: 'chat',
      buildLog: 'Docker build failed',
    });
  }

  function getToolExecutor(
    tools: Record<
      string,
      { execute?: (input: Record<string, unknown>, options?: unknown) => Promise<unknown> }
    >,
    toolName: string,
  ): (input: Record<string, unknown>) => Promise<unknown> {
    const target = tools[toolName];
    expect(target).toBeDefined();
    expect(target?.execute).toBeDefined();
    return (input) => target.execute!(input, {});
  }

  it('fix_dockerfile asks for approval, persists pending fix, then redeploys on approve', async () => {
    seedFailedProject();

    const clonePath = join(tmpDir, 'repo');
    writeFileSync(join(tmpDir, 'placeholder.txt'), 'x', 'utf8');
    rmSync(join(tmpDir, 'placeholder.txt'), { force: true });
    rmSync(clonePath, { recursive: true, force: true });
    mkdtempSync(join(tmpDir, 'repo-'));
    const realClonePath = join(tmpDir, 'repo-fix');
    rmSync(realClonePath, { recursive: true, force: true });
    mkdirSync(realClonePath, { recursive: true });
    writeFileSync(join(realClonePath, 'Dockerfile'), 'FROM node:18\nRUN npm install\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: realClonePath, commitSha: 'deadbeef' });

    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;

    const { tools, startDeploy } = createToolsContext(bridge);
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    const result = await runFixDockerfile({ project_name: 'demo' });

    expect(bridge.ask).toHaveBeenCalledOnce();
    const request = (
      bridge.ask as unknown as {
        mock: {
          calls: Array<[{ questions?: Array<{ metadata?: unknown }> }]>;
        };
      }
    ).mock.calls[0]?.[0];
    const firstQuestionMetadata = request?.questions?.[0]?.metadata;
    expect(firstQuestionMetadata).toEqual(
      expect.objectContaining({
        fixType: 'dockerfile',
        filePath: 'Dockerfile',
        before: expect.stringContaining('FROM node:18'),
        after: expect.stringContaining('FROM node:20'),
      }),
    );

    const project = db.getProject('p1');
    expect(project?.pending_fix).toBeTruthy();
    const pendingFix = JSON.parse(project?.pending_fix ?? '{}') as {
      filePath?: string;
      content?: string;
    };
    expect(pendingFix.filePath).toBe('Dockerfile');
    expect(pendingFix.content).toContain('FROM node:20');

    expect(startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/openlander/demo',
        name: 'demo',
      }),
    );
    expect(result).toEqual(expect.objectContaining({ status: 'approved' }));
  });

  it('fix_dockerfile returns suggestion only when user rejects', async () => {
    seedFailedProject();
    const clonePath = join(tmpDir, 'repo-reject');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:18\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: 'cafebabe' });

    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Show me other options'], customText: '' },
        ]),
    } as unknown as QuestionBridge;

    const { tools, startDeploy } = createToolsContext(bridge);
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    const result = await runFixDockerfile({ project_name: 'demo' });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(db.getProject('p1')?.pending_fix).toBeNull();
    expect(result).toEqual(expect.objectContaining({ status: 'rejected' }));
  });

  it('fix_dockerfile stops after 3 attempts for the same failed deploy', async () => {
    seedFailedProject();
    const clonePath = join(tmpDir, 'repo-limit');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:18\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: 'beaded' });

    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Show me other options'], customText: '' },
        ]),
    } as unknown as QuestionBridge;

    const { tools } = createToolsContext(bridge);
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    await runFixDockerfile({ project_name: 'demo' });
    await runFixDockerfile({ project_name: 'demo' });
    await runFixDockerfile({ project_name: 'demo' });
    const fourth = await runFixDockerfile({ project_name: 'demo' });

    expect(bridge.ask).toHaveBeenCalledTimes(3);
    expect(fourth).toEqual(expect.objectContaining({ error: 'MAX_FIX_ATTEMPTS_REACHED' }));
  });

  it('ask_user_question applies approved compose fix using same pending-fix path', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const questions = JSON.stringify([
      {
        question: 'Apply compose fix?',
        options: [{ label: 'Apply this fix and redeploy' }],
        metadata: {
          fixType: 'compose',
          projectId: 'p1',
          filePath: 'docker-compose.yml',
          after: 'services:\n  web:\n    image: nginx',
          failureId: 'fail-1',
        },
      },
    ]);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const result = await runAskUserQuestion({ questions });
    const pendingRaw = db.getProject('p1')?.pending_fix;
    const pendingFix = JSON.parse(pendingRaw ?? '{}') as { filePath?: string; content?: string };

    expect(pendingFix.filePath).toBe('docker-compose.yml');
    expect(pendingFix.content).toContain('services:');
    expect(startDeploy).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({ appliedFix: true, fixType: 'compose' }));
  });

  it('deploy_compose includes compose file content in BUILD_FAILED response', async () => {
    const bridge = {
      ask: vi.fn(),
    } as unknown as QuestionBridge;
    const { tools, composePipeline } = createToolsContext(bridge);

    const clonePath = join(tmpDir, 'repo-compose');
    mkdirSync(clonePath, { recursive: true });
    const composePath = join(clonePath, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  web:\n    image: nginx\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: 'feedface' });
    composePipeline.detectComposeFile.mockReturnValue(composePath);
    composePipeline.deployCompose.mockResolvedValue({
      success: false,
      parentProjectId: 'p1',
      parentName: 'demo',
      services: [],
      buildDurationMs: 0,
      error: 'env_file missing',
    });

    const runDeployCompose = getToolExecutor(tools, 'deploy_compose');
    const result = await runDeployCompose({
      repo_url: 'https://github.com/openlander/demo',
      name: 'demo',
    });

    expect(result).toEqual(
      expect.objectContaining({
        error: 'BUILD_FAILED',
        composePath,
        composeContent: expect.stringContaining('services:'),
      }),
    );
  });

  it('deploy_compose returns COMPOSE_FILE_NOT_FOUND when compose is missing', async () => {
    const { tools, composePipeline } = createToolsContext();
    cloneRepoMock.mockResolvedValue({ path: tmpDir, commitSha: 'facefeed' });
    composePipeline.detectComposeFile.mockReturnValue(null);

    const runDeployCompose = getToolExecutor(tools, 'deploy_compose');
    const result = await runDeployCompose({
      repo_url: 'https://github.com/openlander/demo',
      name: 'demo',
    });

    expect(result).toEqual(
      expect.objectContaining({
        error: 'COMPOSE_FILE_NOT_FOUND',
        message: expect.stringContaining('No compose file found'),
      }),
    );
  });

  it('deploy_compose returns BUILD_FAILED with empty compose content when read fails', async () => {
    const { tools, composePipeline } = createToolsContext();
    cloneRepoMock.mockResolvedValue({ path: tmpDir, commitSha: '00aa11' });
    const missingComposePath = join(tmpDir, 'missing-compose.yml');
    composePipeline.detectComposeFile.mockReturnValue(missingComposePath);
    composePipeline.deployCompose.mockResolvedValue({
      success: false,
      parentProjectId: 'p1',
      parentName: 'demo',
      services: [],
      buildDurationMs: 0,
      error: 'compose failed',
    });

    const runDeployCompose = getToolExecutor(tools, 'deploy_compose');
    const result = await runDeployCompose({
      repo_url: 'https://github.com/openlander/demo',
      name: 'demo',
    });

    expect(result).toEqual(
      expect.objectContaining({
        error: 'BUILD_FAILED',
        composePath: missingComposePath,
        composeContent: '',
      }),
    );
  });

  it('scan_project clones repository and reports single-project metadata', async () => {
    const clonePath = join(tmpDir, 'repo-single');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:22\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: 'single123' });

    const { tools } = createToolsContext();
    const runScanProject = getToolExecutor(tools, 'scan_project');
    const result = await runScanProject({
      repo_url: 'https://github.com/openlander/single',
      branch: 'main',
    });

    expect(cloneRepoMock).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/openlander/single',
      branch: 'main',
      sshKeyPath: undefined,
    });
    expect(result).toEqual({
      isMonorepo: false,
      dockerfiles: ['Dockerfile'],
      composeFiles: [],
      clonePath,
    });
  });

  it('scan_project reuses clone_path and reports monorepo-like metadata', async () => {
    const clonePath = join(tmpDir, 'repo-mono');
    mkdirSync(join(clonePath, 'service-a'), { recursive: true });
    mkdirSync(join(clonePath, 'service-b'), { recursive: true });
    writeFileSync(join(clonePath, 'service-a', 'Dockerfile'), 'FROM node:22\n', 'utf8');
    writeFileSync(join(clonePath, 'service-b', 'Dockerfile'), 'FROM node:22\n', 'utf8');
    writeFileSync(
      join(clonePath, 'docker-compose.yml'),
      'services:\n  api:\n    build: .\n',
      'utf8',
    );

    const { tools } = createToolsContext();
    const runScanProject = getToolExecutor(tools, 'scan_project');
    const result = await runScanProject({
      repo_url: 'https://github.com/openlander/mono',
      clone_path: clonePath,
    });

    expect(cloneRepoMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      isMonorepo: true,
      dockerfiles: ['service-a/Dockerfile', 'service-b/Dockerfile'],
      composeFiles: ['docker-compose.yml'],
      clonePath,
    });
  });

  it('fix_dockerfile returns proposal_ready when question bridge is not provided', async () => {
    seedFailedProject();
    const clonePath = join(tmpDir, 'repo-no-bridge');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:18\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: '123abc' });

    const { tools, startDeploy } = createToolsContext();
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    const result = await runFixDockerfile({ project_name: 'demo' });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'proposal_ready',
        attempts: 1,
        dockerfileContent: expect.stringContaining('FROM node:20'),
      }),
    );
  });

  it('fix_dockerfile returns dismissed when user closes the question', async () => {
    seedFailedProject();
    const clonePath = join(tmpDir, 'repo-dismissed');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:18\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: '123abd' });

    const bridge = {
      ask: vi.fn().mockResolvedValue([]),
    } as unknown as QuestionBridge;

    const { tools, startDeploy } = createToolsContext(bridge);
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    const result = await runFixDockerfile({ project_name: 'demo' });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'dismissed',
        attempts: 1,
      }),
    );
  });

  it('fix_dockerfile returns MISSING_REPO_URL when project has no repo URL', async () => {
    db.createProject({
      id: 'p2',
      name: 'no-repo',
      repoUrl: '',
      branch: 'main',
    });
    db.createDeployLog({
      id: 'fail-norepo',
      projectId: 'p2',
      status: 'failed',
      trigger: 'chat',
      buildLog: 'Docker build failed',
    });

    const clonePath = join(tmpDir, 'repo-no-url');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:18\n', 'utf8');
    cloneRepoMock.mockResolvedValue({ path: clonePath, commitSha: '123abe' });

    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;

    const { tools, startDeploy } = createToolsContext(bridge);
    const runFixDockerfile = getToolExecutor(tools, 'fix_dockerfile');
    const result = await runFixDockerfile({ project_name: 'no-repo' });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        error: 'MISSING_REPO_URL',
      }),
    );
  });

  it('ask_user_question returns dismissed when no answer is submitted', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi.fn().mockResolvedValue([]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const result = await runAskUserQuestion({
      questions: JSON.stringify([
        {
          question: 'Apply this?',
          options: [{ label: 'Apply now' }],
        },
      ]),
    });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        dismissed: true,
      }),
    );
  });

  it('ask_user_question returns plain answers when metadata cannot produce a pending fix', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([{ questionIndex: 0, selectedLabels: ['Apply now'], customText: '' }]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const result = await runAskUserQuestion({
      questions: JSON.stringify([
        {
          question: 'Apply this?',
          options: [{ label: 'Apply now' }],
          metadata: {
            projectId: 'p1',
            after: 'missing filePath branch',
          },
        },
      ]),
    });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        answers: expect.arrayContaining([
          expect.objectContaining({ selectedLabels: ['Apply now'], questionIndex: 0 }),
        ]),
      }),
    );
  });

  it('ask_user_question enforces max attempts for approved fixes', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const questions = {
      questions: JSON.stringify([
        {
          question: 'Apply compose fix?',
          options: [{ label: 'Apply this fix and redeploy' }],
          metadata: {
            fixType: 'compose',
            projectId: 'p1',
            filePath: 'docker-compose.yml',
            after: 'services:\n  web:\n    image: nginx',
            failureId: 'fail-1',
          },
        },
      ]),
    };

    await runAskUserQuestion(questions);
    await runAskUserQuestion(questions);
    await runAskUserQuestion(questions);
    const fourth = await runAskUserQuestion(questions);

    expect(startDeploy).toHaveBeenCalledTimes(3);
    expect(fourth).toEqual(
      expect.objectContaining({
        maxAttemptsReached: true,
        fixType: 'compose',
      }),
    );
  });

  it('ask_user_question resets retry guard when failure chain ID changes', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const firstFailureQuestions = {
      questions: JSON.stringify([
        {
          question: 'Apply compose fix?',
          options: [{ label: 'Apply this fix and redeploy' }],
          metadata: {
            fixType: 'compose',
            projectId: 'p1',
            filePath: 'docker-compose.yml',
            after: 'services:\n  web:\n    image: nginx',
            failureId: 'fail-1',
          },
        },
      ]),
    };
    const secondFailureQuestions = {
      questions: JSON.stringify([
        {
          question: 'Apply compose fix?',
          options: [{ label: 'Apply this fix and redeploy' }],
          metadata: {
            fixType: 'compose',
            projectId: 'p1',
            filePath: 'docker-compose.yml',
            after: 'services:\n  web:\n    image: nginx:stable',
            failureId: 'fail-2',
          },
        },
      ]),
    };

    await runAskUserQuestion(firstFailureQuestions);
    await runAskUserQuestion(firstFailureQuestions);
    await runAskUserQuestion(firstFailureQuestions);

    const blocked = await runAskUserQuestion(firstFailureQuestions);
    const newChainAttempt = await runAskUserQuestion(secondFailureQuestions);

    expect(blocked).toEqual(expect.objectContaining({ maxAttemptsReached: true }));
    expect(newChainAttempt).toEqual(
      expect.objectContaining({ appliedFix: true, fixType: 'compose' }),
    );
    expect(startDeploy).toHaveBeenCalledTimes(4);
  });

  it('persists pending_fix in DB so it survives process restart before deploy apply', () => {
    seedFailedProject();
    db.updateProject('p1', {
      pendingFix: JSON.stringify({
        filePath: 'Dockerfile',
        content: 'FROM node:20\nRUN npm ci\n',
      }),
    });

    db.close();
    db = new Database(join(tmpDir, 'test.db'));

    const reloadedProject = db.getProject('p1');
    expect(reloadedProject?.pending_fix).toBeTruthy();
    const pendingFix = JSON.parse(reloadedProject?.pending_fix ?? '{}') as {
      filePath?: string;
      content?: string;
    };
    expect(pendingFix.filePath).toBe('Dockerfile');
    expect(pendingFix.content).toContain('RUN npm ci');
  });

  it('ask_user_question resolves target project by projectName metadata', async () => {
    seedFailedProject();
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const result = await runAskUserQuestion({
      questions: JSON.stringify([
        {
          question: 'Apply dockerfile fix?',
          options: [{ label: 'Apply this fix and redeploy' }],
          metadata: {
            fixType: 'dockerfile',
            projectName: 'demo',
            filePath: 'Dockerfile',
            after: 'FROM node:20',
          },
        },
      ]),
    });

    expect(startDeploy).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({ appliedFix: true, fixType: 'dockerfile' }));
  });

  it('ask_user_question returns MISSING_REPO_URL for metadata-targeted project without repo', async () => {
    db.createProject({
      id: 'p3',
      name: 'missing-repo',
      repoUrl: '',
      branch: 'main',
    });
    const bridge = {
      ask: vi
        .fn()
        .mockResolvedValue([
          { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
        ]),
    } as unknown as QuestionBridge;
    const { tools, startDeploy } = createToolsContext(bridge);

    const runAskUserQuestion = getToolExecutor(tools, 'ask_user_question');
    const result = await runAskUserQuestion({
      questions: JSON.stringify([
        {
          question: 'Apply compose fix?',
          options: [{ label: 'Apply this fix and redeploy' }],
          metadata: {
            fixType: 'compose',
            projectId: 'p3',
            filePath: 'docker-compose.yml',
            after: 'services:\n  web:\n    image: nginx',
          },
        },
      ]),
    });

    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ error: 'MISSING_REPO_URL' }));
  });

  it('createTools omits ask_user_question when question bridge is not provided', () => {
    const { tools } = createToolsContext();
    expect(tools.ask_user_question).toBeUndefined();
  });

  it('list_github_repos returns GITHUB_NOT_CONFIGURED when token is missing', async () => {
    const { tools } = createToolsContext();
    loadConfigMock.mockReturnValue({
      gitProviders: {
        github: {
          token: '',
        },
      },
    } as ReturnType<typeof configModule.loadConfig>);

    const runListGithubRepos = getToolExecutor(tools, 'list_github_repos');
    const result = await runListGithubRepos({});

    expect(result).toEqual(
      expect.objectContaining({
        error: 'GITHUB_NOT_CONFIGURED',
      }),
    );
    expect(createGitProviderMock).not.toHaveBeenCalled();
  });

  it('search_github_repos returns GITHUB_NOT_CONFIGURED when token is missing', async () => {
    const { tools } = createToolsContext();
    loadConfigMock.mockReturnValue({
      gitProviders: {
        github: {
          token: '',
        },
      },
    } as ReturnType<typeof configModule.loadConfig>);

    const runSearchGithubRepos = getToolExecutor(tools, 'search_github_repos');
    const result = await runSearchGithubRepos({ query: 'demo' });

    expect(result).toEqual(
      expect.objectContaining({
        error: 'GITHUB_NOT_CONFIGURED',
      }),
    );
    expect(createGitProviderMock).not.toHaveBeenCalled();
  });

  it('list_services returns service count and parsed credentials', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'shared-postgres',
        type: 'postgresql',
        status: 'running',
        port: 5432,
        container_name: 'openlander-postgres',
        credentials: JSON.stringify({
          host: 'openlander-postgres',
          port: 5432,
          user: 'postgres',
          password: 'secret',
        }),
      },
      {
        id: 'svc-2',
        name: 'shared-redis',
        type: 'redis',
        status: 'stopped',
        port: 6379,
        container_name: 'openlander-redis',
        credentials: null,
      },
    ]);

    const runListServices = getToolExecutor(tools, 'list_services');
    const result = await runListServices({});

    expect(result).toEqual({
      count: 2,
      services: [
        {
          id: 'svc-1',
          name: 'shared-postgres',
          type: 'postgresql',
          status: 'running',
          port: 5432,
          containerName: 'openlander-postgres',
          credentials: {
            host: 'openlander-postgres',
            port: 5432,
            user: 'postgres',
            password: 'secret',
          },
        },
        {
          id: 'svc-2',
          name: 'shared-redis',
          type: 'redis',
          status: 'stopped',
          port: 6379,
          containerName: 'openlander-redis',
          credentials: null,
        },
      ],
    });
  });

  it('list_databases returns database list for named service', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'shared-postgres',
      },
    ]);
    serviceManager.listDatabases.mockResolvedValue([
      { name: 'app_db', sizeBytes: 2048 },
      { name: 'analytics', sizeBytes: null },
    ]);

    const runListDatabases = getToolExecutor(tools, 'list_databases');
    const result = await runListDatabases({ service_name: 'shared-postgres' });

    expect(serviceManager.listDatabases).toHaveBeenCalledWith('svc-1');
    expect(result).toEqual({
      service: 'shared-postgres',
      count: 2,
      databases: [
        { name: 'app_db', sizeBytes: 2048 },
        { name: 'analytics', sizeBytes: null },
      ],
    });
  });

  it('list_databases returns SERVICE_NOT_FOUND error when service does not exist', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([{ id: 'svc-1', name: 'other-service' }]);

    const runListDatabases = getToolExecutor(tools, 'list_databases');
    const result = await runListDatabases({ service_name: 'shared-postgres' });

    expect(serviceManager.listDatabases).not.toHaveBeenCalled();
    expect(result).toEqual({ error: 'Service not found: shared-postgres' });
  });

  it('create_database creates database and returns connection details', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'shared-postgres',
      },
    ]);
    serviceManager.createDatabase.mockResolvedValue({
      database: 'app_db',
      user: 'postgres',
      password: 'secret',
      connectionString: 'postgresql://postgres:secret@shared-postgres:5432/app_db',
    });

    const runCreateDatabase = getToolExecutor(tools, 'create_database');
    const result = await runCreateDatabase({
      service_name: 'shared-postgres',
      database_name: 'app_db',
    });

    expect(serviceManager.createDatabase).toHaveBeenCalledWith('svc-1', 'app_db');
    expect(result).toEqual({
      status: 'created',
      service: 'shared-postgres',
      database: 'app_db',
      user: 'postgres',
      password: 'secret',
      connectionString: 'postgresql://postgres:secret@shared-postgres:5432/app_db',
    });
  });

  it('create_database returns service manager errors', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'shared-redis',
      },
    ]);
    serviceManager.createDatabase.mockRejectedValue(
      new Error('Database creation is not supported for redis services'),
    );

    const runCreateDatabase = getToolExecutor(tools, 'create_database');
    const result = await runCreateDatabase({
      service_name: 'shared-redis',
      database_name: 'cache_db',
    });

    expect(result).toEqual({ error: 'Database creation is not supported for redis services' });
  });

  it('covers list_services -> list_databases -> create_database workflow coherently', async () => {
    const { tools, serviceManager } = createToolsContext();
    serviceManager.list.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'shared-postgres',
        type: 'postgresql',
        status: 'running',
        port: 5432,
        container_name: 'ol-svc-shared-postgres',
        credentials: JSON.stringify({
          host: 'ol-svc-shared-postgres',
          port: 5432,
          user: 'openlander',
          password: 'pw',
          database: 'openlander',
        }),
      },
    ]);
    serviceManager.listDatabases.mockResolvedValue([{ name: 'openlander', sizeBytes: 1024 }]);
    serviceManager.createDatabase.mockResolvedValue({
      database: 'appdb',
      user: 'openlander',
      password: 'pw',
      connectionString: 'postgresql://openlander:pw@ol-svc-shared-postgres:5432/appdb',
    });

    const runListServices = getToolExecutor(tools, 'list_services');
    const runListDatabases = getToolExecutor(tools, 'list_databases');
    const runCreateDatabase = getToolExecutor(tools, 'create_database');

    const servicesResult = (await runListServices({})) as {
      count: number;
      services: Array<{ name: string }>;
    };
    expect(servicesResult.count).toBe(1);
    expect(servicesResult.services[0]?.name).toBe('shared-postgres');

    const databasesResult = (await runListDatabases({
      service_name: servicesResult.services[0]!.name,
    })) as {
      service: string;
      count: number;
      databases: Array<{ name: string; sizeBytes: number | null }>;
    };
    expect(databasesResult).toEqual({
      service: 'shared-postgres',
      count: 1,
      databases: [{ name: 'openlander', sizeBytes: 1024 }],
    });

    const createResult = (await runCreateDatabase({
      service_name: servicesResult.services[0]!.name,
      database_name: 'appdb',
    })) as {
      status: string;
      service: string;
      database: string;
      user: string;
      password: string;
      connectionString: string;
    };
    expect(createResult).toEqual({
      status: 'created',
      service: 'shared-postgres',
      database: 'appdb',
      user: 'openlander',
      password: 'pw',
      connectionString: 'postgresql://openlander:pw@ol-svc-shared-postgres:5432/appdb',
    });
    expect(serviceManager.listDatabases).toHaveBeenCalledWith('svc-1');
    expect(serviceManager.createDatabase).toHaveBeenCalledWith('svc-1', 'appdb');
  });
});
