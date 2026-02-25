import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Agent } from '../src/agent/index.js';
import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from '../src/llm/index.js';
import type { ToolDefinition } from '../src/agent/tools.js';
import { Database } from '../src/db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTool(name: string, result: unknown = { ok: true }): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {},
    execute: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue(result),
  };
}

interface MockLLMOptions {
  /** Responses to return in sequence. Each can have content and optional toolCalls. */
  responses: LLMResponse[];
}

function createMockLLM(opts: MockLLMOptions): LLMClient & { chat: ReturnType<typeof vi.fn> } {
  let callIndex = 0;
  const chatFn = vi
    .fn<(messages: ChatMessage[]) => Promise<LLMResponse>>()
    .mockImplementation(async () => {
      const response = opts.responses[callIndex];
      if (!response) {
        // Default: return text with no tool calls
        return { content: 'No more responses configured.' };
      }
      callIndex++;
      return response;
    });

  return { chat: chatFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent — agentic loop', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns text directly when LLM has no tool calls', async () => {
    const llm = createMockLLM({
      responses: [{ content: 'Hello! How can I help?' }],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    const result = await agent.chat('hi');

    expect(result.message).toBe('Hello! How can I help?');
    expect(result.toolResults).toBeUndefined();
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it('executes tool calls and loops back to LLM', async () => {
    const listTool = createMockTool('list_projects', [{ name: 'my-app', status: 'running' }]);

    const llm = createMockLLM({
      responses: [
        // Step 1: LLM calls a tool
        { content: '', toolCalls: [{ name: 'list_projects', arguments: {} }] },
        // Step 2: LLM responds with text (no more tool calls)
        { content: 'You have 1 project: my-app (running).' },
      ],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([listTool]);

    const result = await agent.chat('list my projects');

    expect(result.message).toBe('You have 1 project: my-app (running).');
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.toolName).toBe('list_projects');
    expect(result.toolResults![0]!.success).toBe(true);
    expect(listTool.execute).toHaveBeenCalledOnce();
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it('handles multi-step tool chains', async () => {
    const deployTool = createMockTool('deploy_project', {
      projectId: 'p1',
      url: 'http://localhost:10001',
    });
    const exposeTool = createMockTool('expose_public', {
      publicUrl: 'https://abc.trycloudflare.com',
    });

    const llm = createMockLLM({
      responses: [
        // Step 1: deploy
        {
          content: '',
          toolCalls: [{ name: 'deploy_project', arguments: { repoUrl: 'https://github.com/u/r' } }],
        },
        // Step 2: expose
        { content: '', toolCalls: [{ name: 'expose_public', arguments: { projectId: 'p1' } }] },
        // Step 3: final response
        { content: 'Deployed and exposed at https://abc.trycloudflare.com' },
      ],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([deployTool, exposeTool]);

    const result = await agent.chat('deploy and make it public');

    expect(result.message).toContain('trycloudflare.com');
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults![0]!.toolName).toBe('deploy_project');
    expect(result.toolResults![1]!.toolName).toBe('expose_public');
    expect(llm.chat).toHaveBeenCalledTimes(3);
  });

  it('handles tool execution errors gracefully', async () => {
    const failTool: ToolDefinition = {
      name: 'deploy_project',
      description: 'Deploy',
      parameters: {},
      execute: vi
        .fn<(args: Record<string, unknown>) => Promise<unknown>>()
        .mockRejectedValue(new Error('Docker not running')),
    };

    const llm = createMockLLM({
      responses: [
        { content: '', toolCalls: [{ name: 'deploy_project', arguments: { repoUrl: 'test' } }] },
        { content: 'Deploy failed: Docker is not running.' },
      ],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([failTool]);

    const result = await agent.chat('deploy my app');

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.success).toBe(false);
    expect(result.toolResults![0]!.error).toBe('Docker not running');
    expect(result.message).toContain('Docker');
  });

  it('handles unknown tool names', async () => {
    const llm = createMockLLM({
      responses: [
        { content: '', toolCalls: [{ name: 'nonexistent_tool', arguments: {} }] },
        { content: 'That tool does not exist.' },
      ],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([]);

    const result = await agent.chat('do something');

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0]!.success).toBe(false);
    expect(result.toolResults![0]!.error).toContain('Unknown tool');
  });

  it('stops at MAX_TOOL_STEPS and returns fallback message', async () => {
    // LLM always returns tool calls — should stop after 10 iterations
    const dummyTool = createMockTool('list_projects', []);
    const toolCallResponse: LLMResponse = {
      content: '',
      toolCalls: [{ name: 'list_projects', arguments: {} }],
    };

    const llm = createMockLLM({
      // 11 responses all with tool calls — only 10 will be consumed, the 11th is never reached
      responses: Array.from({ length: 11 }, () => toolCallResponse),
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([dummyTool]);

    const result = await agent.chat('infinite loop');

    expect(result.message).toContain('maximum number of steps');
    expect(result.toolResults).toHaveLength(10);
    expect(llm.chat).toHaveBeenCalledTimes(10);
    expect(dummyTool.execute).toHaveBeenCalledTimes(10);
  });
});

describe('Agent — history management', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-hist-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds system prompt on each chat call', async () => {
    let callCount = 0;
    const contextProvider = () => {
      callCount++;
      return `call-${String(callCount)}`;
    };

    const llm = createMockLLM({
      responses: [{ content: 'Response 1' }, { content: 'Response 2' }],
    });

    const agent = new Agent(llm, db, contextProvider, 'gemini');

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
    // Each chat call adds: user message + (potentially tool results) + assistant message
    // With no tool calls, each chat adds 2 messages (user + assistant) to history after system prompt.
    // We need > 40 total messages.

    const responses: LLMResponse[] = [];
    for (let i = 0; i < 25; i++) {
      responses.push({ content: `Response ${String(i)}` });
    }

    const llm = createMockLLM({ responses });
    const agent = new Agent(llm, db, () => '', 'gemini');

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
    const llm = createMockLLM({ responses: [{ content: 'Hi' }] });
    const agent = new Agent(llm, db, () => '', 'gemini');

    await agent.chat('hello');
    expect(agent.getHistory().length).toBeGreaterThan(0);

    agent.clearHistory();
    expect(agent.getHistory()).toHaveLength(0);
  });
});

describe('Agent — chatStream', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-stream-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits session, thinking, message, and done events', async () => {
    const llm = createMockLLM({
      responses: [{ content: 'Stream response' }],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
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

    const llm = createMockLLM({
      responses: [
        { content: '', toolCalls: [{ name: 'list_projects', arguments: {} }] },
        { content: 'Done listing.' },
      ],
    });

    const agent = new Agent(llm, db, () => '', 'gemini');
    agent.setTools([listTool]);
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
    const llm: LLMClient = {
      chat: vi
        .fn<(messages: ChatMessage[]) => Promise<LLMResponse>>()
        .mockRejectedValue(new Error('API rate limit')),
    };

    const agent = new Agent(llm, db, () => '', 'gemini');
    const events: Array<{ type: string; error?: string }> = [];

    await agent.chatStream('hello', async (event) => {
      events.push(event as { type: string; error?: string });
    });

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error).toContain('rate limit');
  });
});
