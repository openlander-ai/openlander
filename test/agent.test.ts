import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Agent } from '../src/agent/index.js';
import type { ToolResult } from '../src/agent/index.js';
import type { ToolSet, LanguageModel } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { Database } from '../src/db/index.js';

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
  generateText: vi.fn(async (opts: Parameters<typeof mockGenerateTextImplementation>[0]) => {
    if (!mockGenerateTextImplementation) {
      return { text: 'Default response', steps: [] };
    }
    const result = await mockGenerateTextImplementation(opts);
    return {
      text: result.text,
      steps: result.steps ?? [],
    };
  }),
  streamText: vi.fn((opts: Parameters<typeof mockStreamTextImplementation>[0]) => {
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
      parameters: z.ZodSchema;
      execute: (args: unknown) => Promise<unknown>;
    }) => config,
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock tool using AI SDK tool() pattern */
function createMockTool(name: string, result: unknown = { ok: true }) {
  return tool({
    description: `Mock tool: ${name}`,
    parameters: z.object({}),
    execute: vi.fn<() => Promise<unknown>>().mockResolvedValue(result),
  });
}

/** Create a failing mock tool */
function createFailingMockTool(name: string, error: Error) {
  return tool({
    description: `Mock tool: ${name}`,
    parameters: z.object({}),
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
