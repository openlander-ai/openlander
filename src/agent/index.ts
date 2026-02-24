import type { LLMClient, ChatMessage, LLMResponse } from '../llm/index.js';
import type { Database } from '../db/index.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { ToolDefinition } from './tools.js';

/**
 * OpenLander AI Agent.
 *
 * Single agent with ~10 tools. NOT multi-agent.
 *
 * The agent's role is limited to:
 * 1. Intent parsing: "deploy this" → deploy tool call
 * 2. Clarification: "which project?" / "make it public?"
 * 3. Error explanation: build log → human-readable diagnosis
 *
 * All execution is handled by the deterministic pipeline.
 * The LLM never runs Docker commands directly.
 */
export class Agent {
  private history: ChatMessage[] = [];
  private tools: ToolDefinition[] = [];

  constructor(
    private readonly llm: LLMClient,
    private readonly db: Database,
  ) {
    this.history.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
  }

  /** Register tools for the agent to use. */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;

    // If the LLM provider supports tool registration, do it
    if ('setTools' in this.llm && typeof this.llm.setTools === 'function') {
      (this.llm as { setTools: (tools: ToolDefinition[]) => void }).setTools(tools);
    }
  }

  /** Get the database instance (for tool execution context). */
  getDb(): Database {
    return this.db;
  }

  /** Process a user message and return the agent's response. */
  async chat(userMessage: string, sessionId?: string): Promise<AgentResponse> {
    this.history.push({ role: 'user', content: userMessage });

    // Save user message to DB
    if (sessionId) {
      const { nanoid } = await import('nanoid');
      this.db.saveChatMessage({
        id: nanoid(12),
        sessionId,
        role: 'user',
        content: userMessage,
      });
    }

    const response = await this.llm.chat(this.history);

    // If the LLM wants to call tools, execute them
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults = await this.executeTools(response.toolCalls);

      // Build assistant message with tool results
      const resultSummary = toolResults
        .map((r) =>
          r.success
            ? `Tool ${r.toolName}: ${JSON.stringify(r.result)}`
            : `Tool ${r.toolName} failed: ${r.error ?? 'unknown'}`
        )
        .join('\n');

      // Send tool results back to LLM for natural language response
      this.history.push({ role: 'assistant', content: response.content || resultSummary });

      // Save to DB
      if (sessionId) {
        const { nanoid } = await import('nanoid');
        this.db.saveChatMessage({
          id: nanoid(12),
          sessionId,
          role: 'assistant',
          content: response.content || resultSummary,
          toolCalls: toolResults,
        });
      }

      return {
        message: response.content || resultSummary,
        toolResults,
      };
    }

    this.history.push({ role: 'assistant', content: response.content });

    // Save to DB
    if (sessionId) {
      const { nanoid } = await import('nanoid');
      this.db.saveChatMessage({
        id: nanoid(12),
        sessionId,
        role: 'assistant',
        content: response.content,
      });
    }

    return { message: response.content };
  }

  /**
   * Process a user message with streaming SSE events.
   * Yields ChatStreamEvent objects for real-time UI updates.
   */
  async chatStream(
    userMessage: string,
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    sessionId?: string,
  ): Promise<void> {
    const { nanoid } = await import('nanoid');
    const resolvedSessionId = sessionId ?? nanoid(12);

    // Emit session event
    await onEvent({ type: 'session', sessionId: resolvedSessionId });

    this.history.push({ role: 'user', content: userMessage });

    // Save user message to DB
    this.db.saveChatMessage({
      id: nanoid(12),
      sessionId: resolvedSessionId,
      role: 'user',
      content: userMessage,
    });

    // Emit thinking event
    await onEvent({ type: 'thinking' });

    let response: LLMResponse;
    try {
      response = await this.llm.chat(this.history);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await onEvent({ type: 'error', error: errMsg });
      return;
    }

    // If the LLM wants to call tools, execute them with streaming
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults: ToolResult[] = [];

      for (const call of response.toolCalls) {
        await onEvent({ type: 'tool_call', toolName: call.name, arguments: call.arguments });

        const tool = this.tools.find((t) => t.name === call.name);
        if (!tool) {
          const result: ToolResult = { toolName: call.name, success: false, error: `Unknown tool: ${call.name}` };
          toolResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
          continue;
        }

        try {
          const execResult = await tool.execute(call.arguments);
          const result: ToolResult = { toolName: call.name, success: true, result: execResult };
          toolResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
        } catch (error) {
          const result: ToolResult = {
            toolName: call.name,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          toolResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
        }
      }

      const resultSummary = toolResults
        .map((r) => r.success ? `Tool ${r.toolName}: ${JSON.stringify(r.result)}` : `Tool ${r.toolName} failed: ${r.error ?? 'unknown'}`)
        .join('\n');

      const content = response.content || resultSummary;
      this.history.push({ role: 'assistant', content });

      // Save to DB
      this.db.saveChatMessage({
        id: nanoid(12),
        sessionId: resolvedSessionId,
        role: 'assistant',
        content,
        toolCalls: toolResults,
      });

      await onEvent({ type: 'message', content });
      await onEvent({ type: 'done', toolResults });
      return;
    }

    // No tool calls — just a text response
    this.history.push({ role: 'assistant', content: response.content });

    this.db.saveChatMessage({
      id: nanoid(12),
      sessionId: resolvedSessionId,
      role: 'assistant',
      content: response.content,
    });

    await onEvent({ type: 'message', content: response.content });
    await onEvent({ type: 'done' });
  }

  /** Get the conversation history. */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /** Clear conversation history (keeps system prompt). */
  clearHistory(): void {
    this.history = [this.history[0] ?? { role: 'system' as const, content: '' }]; // Keep system prompt
  }

  /** Execute tool calls from the LLM. */
  private async executeTools(
    toolCalls: NonNullable<LLMResponse['toolCalls']>,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = this.tools.find((t) => t.name === call.name);
      if (!tool) {
        results.push({
          toolName: call.name,
          success: false,
          error: `Unknown tool: ${call.name}`,
        });
        continue;
      }

      try {
        const result = await tool.execute(call.arguments);
        results.push({ toolName: call.name, success: true, result });
      } catch (error) {
        results.push({
          toolName: call.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}

export interface AgentResponse {
  message: string;
  toolResults?: ToolResult[];
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// --- SSE Streaming Types ---

export type ChatStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; success: boolean; result?: unknown; error?: string }
  | { type: 'message'; content: string }
  | { type: 'done'; toolResults?: ToolResult[] }
  | { type: 'error'; error: string };
