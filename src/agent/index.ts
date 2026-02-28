import type { LLMClient, ChatMessage, LLMResponse } from '../llm/index.js';
import type { QuestionRequest, QuestionBridge } from './question-bridge.js';
import type { Database } from '../db/index.js';
import { buildSystemPrompt, type ContextProvider, type LLMProvider } from './prompts.js';
import type { ToolDefinition } from './tools.js';

/**
 * OpenLander AI Agent.
 *
 * Single agent with ~20 tools. NOT multi-agent.
 *
 * Architecture changes (v0.4.1):
 *   - Agentic loop: LLM → tool → result → LLM → ... (max 10 steps)
 *   - Dynamic system prompt: rebuilt each turn with live server state
 *   - History management: sliding window to prevent token overflow
 *   - Model overlay: thin behavioral corrections per LLM provider
 *
 * The agent's role is limited to:
 * 1. Intent parsing: "deploy this" → deploy tool call
 * 2. Clarification: "which project?" / "make it public?"
 * 3. Error explanation: build log → human-readable diagnosis
 *
 * All execution is handled by the deterministic pipeline.
 * The LLM never runs Docker commands directly.
 */

/** Maximum tool-call loop iterations per user message. */
const MAX_TOOL_STEPS = 10;

/** Maximum conversation history messages before trimming. */
const MAX_HISTORY_MESSAGES = 40;

/** Number of recent messages to keep when trimming. */
const KEEP_RECENT = 30;

export class Agent {
  private history: ChatMessage[] = [];
  private tools: ToolDefinition[] = [];
  private questionBridge: QuestionBridge | null = null;

  constructor(
    private readonly llm: LLMClient,
    private readonly db: Database,
    private readonly contextProvider?: ContextProvider,
    private readonly provider: LLMProvider = 'gemini',
  ) {}

  /** Set the question bridge for ask_user_question tool support. */
  setQuestionBridge(bridge: QuestionBridge): void {
    this.questionBridge = bridge;
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

  /**
   * Process a user message and return the agent's response.
   *
   * Implements an agentic loop: the LLM may call tools, receive results,
   * and call more tools — up to MAX_TOOL_STEPS iterations.
   */
  async chat(userMessage: string, sessionId?: string): Promise<AgentResponse> {
    // Rebuild system prompt with fresh context on each turn
    this.refreshSystemPrompt();

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

    const allToolResults: ToolResult[] = [];

    // --- Agentic Loop ---
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const response = await this.llm.chat(this.history);

      // No tool calls → final text response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.history.push({ role: 'assistant', content: response.content });
        this.trimHistory();

        // Save final response to DB
        if (sessionId) {
          const { nanoid } = await import('nanoid');
          this.db.saveChatMessage({
            id: nanoid(12),
            sessionId,
            role: 'assistant',
            content: response.content,
            toolCalls: allToolResults.length > 0 ? allToolResults : undefined,
          });
        }

        return {
          message: response.content,
          toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        };
      }

      // Execute tools
      const stepResults = await this.executeTools(response.toolCalls);
      allToolResults.push(...stepResults);

      // Add assistant message to history
      this.history.push({
        role: 'assistant',
        content: response.content || `[Calling ${stepResults.map((r) => r.toolName).join(', ')}]`,
      });

      // Add tool results as a user message so the LLM can see them.
      // NOTE: Ideally each provider would use native tool_result message types.
      // Using a formatted user message is the most portable approach across all 5 providers.
      const resultsText = stepResults
        .map((r) =>
          r.success
            ? `${r.toolName}: ${JSON.stringify(r.result)}`
            : `${r.toolName} FAILED: ${r.error ?? 'unknown'}`,
        )
        .join('\n');

      this.history.push({
        role: 'user',
        content: `[Tool Results]\n${resultsText}`,
      });
    }

    // Max steps exhausted
    const fallbackMessage =
      '⚠️ Reached the maximum number of steps for this request. ' +
      'Here is what was completed so far.';

    this.history.push({ role: 'assistant', content: fallbackMessage });
    this.trimHistory();

    return { message: fallbackMessage, toolResults: allToolResults };
  }

  /**
   * Process a user message with streaming SSE events.
   * Yields ChatStreamEvent objects for real-time UI updates.
   *
   * Supports multi-step tool execution — yields events for each step.
   * When ask_user_question is called, emits a 'question' event and pauses
   * until the TUI responds via the QuestionBridge.
   */
  async chatStream(
    userMessage: string,
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    sessionId?: string,
  ): Promise<void> {
    const { nanoid } = await import('nanoid');
    const resolvedSessionId = sessionId ?? nanoid(12);

    // Rebuild system prompt with fresh context
    this.refreshSystemPrompt();

    await onEvent({ type: 'session', sessionId: resolvedSessionId });

    this.history.push({ role: 'user', content: userMessage });

    // Save user message to DB
    this.db.saveChatMessage({
      id: nanoid(12),
      sessionId: resolvedSessionId,
      role: 'user',
      content: userMessage,
    });

    await onEvent({ type: 'thinking' });

    // Wire question bridge to emit through this stream's onEvent callback.
    // This allows ask_user_question tool to pause the agentic loop and
    // emit a question event to the TUI via SSE.
    if (this.questionBridge) {
      this.questionBridge.setQuestionHandler((request: QuestionRequest) => {
        void onEvent({ type: 'question', request });
      });
    }

    const allToolResults: ToolResult[] = [];

    // --- Agentic Loop (streaming) ---
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      let response: LLMResponse;
      try {
        response = await this.llm.chat(this.history);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await onEvent({ type: 'error', error: errMsg });
        return;
      }

      // No tool calls → final text response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.history.push({ role: 'assistant', content: response.content });
        this.trimHistory();

        this.db.saveChatMessage({
          id: nanoid(12),
          sessionId: resolvedSessionId,
          role: 'assistant',
          content: response.content,
          toolCalls: allToolResults.length > 0 ? allToolResults : undefined,
        });

        await onEvent({ type: 'message', content: response.content });
        await onEvent({
          type: 'done',
          toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        });
        return;
      }

      // Execute tools with streaming events
      const stepResults: ToolResult[] = [];

      for (const call of response.toolCalls) {
        await onEvent({ type: 'tool_call', toolName: call.name, arguments: call.arguments });

        const tool = this.tools.find((t) => t.name === call.name);
        if (!tool) {
          const result: ToolResult = {
            toolName: call.name,
            success: false,
            error: `Unknown tool: ${call.name}`,
          };
          stepResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
          continue;
        }

        try {
          const execResult = await tool.execute(call.arguments);
          const result: ToolResult = { toolName: call.name, success: true, result: execResult };
          stepResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
        } catch (error) {
          const result: ToolResult = {
            toolName: call.name,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          stepResults.push(result);
          await onEvent({ type: 'tool_result', ...result });
        }
      }

      allToolResults.push(...stepResults);

      // Add to history for the next loop iteration
      this.history.push({
        role: 'assistant',
        content: response.content || `[Calling ${stepResults.map((r) => r.toolName).join(', ')}]`,
      });

      const resultsText = stepResults
        .map((r) =>
          r.success
            ? `${r.toolName}: ${JSON.stringify(r.result)}`
            : `${r.toolName} FAILED: ${r.error ?? 'unknown'}`,
        )
        .join('\n');

      this.history.push({
        role: 'user',
        content: `[Tool Results]\n${resultsText}`,
      });

      // Emit thinking event for the next iteration
      if (step < MAX_TOOL_STEPS - 1) {
        await onEvent({ type: 'thinking' });
      }
    }

    // Max steps exhausted
    const fallback = '⚠️ Reached the maximum number of steps. Here is what was completed so far.';

    this.history.push({ role: 'assistant', content: fallback });
    this.trimHistory();

    this.db.saveChatMessage({
      id: nanoid(12),
      sessionId: resolvedSessionId,
      role: 'assistant',
      content: fallback,
      toolCalls: allToolResults,
    });

    await onEvent({ type: 'message', content: fallback });
    await onEvent({ type: 'done', toolResults: allToolResults });
  }

  /** Get the conversation history. */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /** Clear conversation history (keeps system prompt). */
  clearHistory(): void {
    this.history = [];
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the system prompt with fresh context and replace it in history.
   * Called at the start of every chat() / chatStream() turn.
   */
  private refreshSystemPrompt(): void {
    const contextSnapshot = this.contextProvider ? this.contextProvider() : '';
    const systemContent = buildSystemPrompt(contextSnapshot, this.provider);

    // Replace or insert system message at position 0
    const first = this.history[0];
    if (first && first.role === 'system') {
      this.history[0] = { role: 'system', content: systemContent };
    } else {
      this.history.unshift({ role: 'system', content: systemContent });
    }
  }

  /**
   * Trim conversation history to prevent token overflow.
   * Keeps the system prompt + a sliding window of recent messages.
   */
  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_MESSAGES) {
      return;
    }

    const system: ChatMessage = this.history[0] ?? { role: 'system', content: '' };
    const trimmed = this.history.length - MAX_HISTORY_MESSAGES;
    const recent = this.history.slice(-KEEP_RECENT);

    // Insert a note about trimmed history
    const trimNote: ChatMessage = {
      role: 'system',
      content: `[Earlier conversation trimmed — ${String(trimmed)} messages removed for context management.]`,
    };

    this.history = [system, trimNote, ...recent];
  }

  /** Execute tool calls from the LLM. */
  private async executeTools(
    toolCalls: NonNullable<LLMResponse['toolCalls']>,
  ): Promise<ToolResult[]> {
    return Promise.all(
      toolCalls.map(async (call): Promise<ToolResult> => {
        const tool = this.tools.find((t) => t.name === call.name);
        if (!tool) {
          return { toolName: call.name, success: false, error: `Unknown tool: ${call.name}` };
        }
        try {
          const result = await tool.execute(call.arguments);
          return { toolName: call.name, success: true, result };
        } catch (error) {
          return {
            toolName: call.name,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
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
  | { type: 'question'; request: QuestionRequest }
  | { type: 'done'; toolResults?: ToolResult[] }
  | { type: 'error'; error: string };
