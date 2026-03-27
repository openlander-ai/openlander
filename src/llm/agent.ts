import { generateText, streamText, stepCountIs } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import type { ChatMessage } from './index.js';
import type { QuestionRequest, QuestionBridge } from '../lib/question-bridge.js';
import type { Database } from '../db/index.js';
import { buildSystemPrompt, type ContextProvider, type LLMProvider } from './prompts.js';
import { createModuleLogger } from '../lib/logger.js';
import { calculateCost, extractUsageFromResult, logAiUsage } from './transparency.js';
import type { AgentResponse, ToolResult, ChatStreamEvent } from '../types/agent-events.js';

/**
 * OpenLander AI Agent.
 *
 * Single agent with ~30 tools. NOT multi-agent.
 *
 * Architecture (v0.0.8 — AI SDK migration):
 *   - Uses Vercel AI SDK generateText/streamText with built-in agentic loop
 *   - Tools defined via AI SDK tool() + Zod schemas
 *   - Dynamic system prompt: rebuilt each turn with live server state
 *   - History management: sliding window to prevent token overflow
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

const DEFAULT_CHANNEL_SESSION_ID = 'channel-default';
const log = createModuleLogger('agent');

export class Agent {
  private history: ChatMessage[] = [];
  private tools: ToolSet = {};
  private questionBridge: QuestionBridge | null = null;
  private currentSessionId: string | null = null;
  private lockPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly model: LanguageModel,
    private readonly db: Database,
    private readonly contextProvider?: ContextProvider,
    private readonly provider: LLMProvider = 'gemini',
    private readonly locale: string = 'en',
  ) {}

  /** Set the question bridge for ask_user_question tool support. */
  setQuestionBridge(bridge: QuestionBridge): void {
    this.questionBridge = bridge;
  }

  /** Register tools for the agent to use. */
  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  /** Get the database instance (for tool execution context). */
  getDb(): Database {
    return this.db;
  }

  /**
   * Process a user message and return the agent's response.
   *
   * Uses AI SDK generateText with built-in multi-step tool execution.
   * The SDK handles the agentic loop: LLM → tool → result → LLM → ...
   */
  async chat(userMessage: string, sessionId?: string): Promise<AgentResponse> {
    return this.withLock(async () => {
      const resolvedSessionId = this.resolveSessionId(sessionId);
      if (resolvedSessionId !== this.currentSessionId) {
        await this.switchSession(resolvedSessionId);
      } else {
        // Rebuild system prompt with fresh context on each turn
        await this.refreshSystemPrompt();
      }

      this.history.push({ role: 'user', content: userMessage });
      const startedAt = Date.now();

      const result = await generateText({
        model: this.model,
        messages: this.history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: this.tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
      });

      // Extract tool results from all steps
      const allToolResults: ToolResult[] = [];
      for (const step of result.steps) {
        for (const toolResult of step.toolResults) {
          allToolResults.push({
            toolName: toolResult.toolName,
            success: true,
            result: toolResult.output,
          });
        }
      }

      const responseText =
        result.text || '⚠️ Reached the maximum number of steps for this request.';

      // Update history with the final response
      this.history.push({ role: 'assistant', content: responseText });
      this.trimHistory();

      const usage = extractUsageFromResult(result.usage);
      this.logUsageSafe({
        sessionId: resolvedSessionId,
        actionType: 'web_agent',
        modelName: this.getModelName(),
        provider: this.provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        toolsCalled: allToolResults.map((toolResult) => toolResult.toolName),
        result: 'success',
        durationMs: Date.now() - startedAt,
        source: 'web',
      });

      return {
        message: responseText,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
      };
    });
  }

  async switchSession(sessionId: string): Promise<void> {
    if (sessionId === this.currentSessionId) {
      return;
    }

    this.history = [];
    this.currentSessionId = sessionId;

    await this.refreshSystemPrompt();
    this.trimHistory();
  }

  /**
   * Process a user message with streaming SSE events.
   * Yields ChatStreamEvent objects for real-time UI updates.
   *
   * Uses AI SDK streamText with fullStream for granular event control.
   * When ask_user_question is called, emits a 'question' event and pauses
   * until the UI responds via the QuestionBridge.
   */
  async chatStream(
    userMessage: string,
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    sessionId?: string,
  ): Promise<void> {
    return this.withLock(async () => {
      const resolvedSessionId = this.resolveSessionId(sessionId);
      if (resolvedSessionId !== this.currentSessionId) {
        await this.switchSession(resolvedSessionId);
      } else {
        // Rebuild system prompt with fresh context
        await this.refreshSystemPrompt();
      }

      await onEvent({ type: 'session', sessionId: resolvedSessionId });

      this.history.push({ role: 'user', content: userMessage });

      await onEvent({ type: 'thinking' });

      // Wire question bridge to emit through this stream's onEvent callback.
      if (this.questionBridge) {
        this.questionBridge.setQuestionHandler((request: QuestionRequest) => {
          void onEvent({ type: 'question', request });
        });
      }

      const allToolResults: ToolResult[] = [];
      let responseText = '';
      const startedAt = Date.now();
      let didStreamFail = false;
      let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      try {
        const result = streamText({
          model: this.model,
          messages: this.history.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          tools: this.tools,
          maxRetries: 1,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
        });

        streamLoop: for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta': {
              responseText += part.text;
              break;
            }
            case 'tool-call': {
              await onEvent({
                type: 'tool_call',
                toolName: part.toolName,
                arguments: part.input as Record<string, unknown>,
              });
              break;
            }
            case 'tool-result': {
              const toolResult: ToolResult = {
                toolName: part.toolName,
                success: true,
                result: part.output,
              };
              allToolResults.push(toolResult);
              await onEvent({ type: 'tool_result', ...toolResult });
              break;
            }
            case 'tool-error': {
              const errorResult: ToolResult = {
                toolName: part.toolName,
                success: false,
                error: part.error instanceof Error ? part.error.message : String(part.error),
              };
              allToolResults.push(errorResult);
              await onEvent({ type: 'tool_result', ...errorResult });
              break;
            }
            case 'finish-step': {
              // Emit thinking for next step if there are more steps coming
              await onEvent({ type: 'thinking' });
              break;
            }
            case 'error': {
              const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
              await onEvent({ type: 'error', error: errMsg });
              didStreamFail = true;
              break streamLoop;
            }
            default:
              break;
          }
        }

        if (!didStreamFail) {
          usage = extractUsageFromResult(await result.usage);
        }
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        const isRateLimit = /rate.limit|too many|429|quota|exceeded/i.test(rawMsg);
        const errMsg = isRateLimit
          ? `LLM rate limit exceeded. Please wait a moment and try again. (${rawMsg})`
          : rawMsg;
        await onEvent({ type: 'error', error: errMsg });
        didStreamFail = true;
      }

      if (didStreamFail) {
        this.logUsageSafe({
          sessionId: resolvedSessionId,
          actionType: 'web_agent',
          modelName: this.getModelName(),
          provider: this.provider,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolsCalled: allToolResults.map((toolResult) => toolResult.toolName),
          result: 'failure',
          durationMs: Date.now() - startedAt,
          source: 'web',
        });
        return;
      }

      const finalText =
        responseText ||
        '⚠️ Reached the maximum number of steps. Here is what was completed so far.';

      // Update history with the final response
      this.history.push({ role: 'assistant', content: finalText });
      this.trimHistory();

      await onEvent({ type: 'message', content: finalText });

      this.logUsageSafe({
        sessionId: resolvedSessionId,
        actionType: 'web_agent',
        modelName: this.getModelName(),
        provider: this.provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        toolsCalled: allToolResults.map((toolResult) => toolResult.toolName),
        result: 'success',
        durationMs: Date.now() - startedAt,
        source: 'web',
      });

      const costUsd = calculateCost(
        this.provider,
        this.getModelName(),
        usage.inputTokens,
        usage.outputTokens,
      );

      await onEvent({
        type: 'done',
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          costUsd,
        },
      });
    });
  }

  /** Get the conversation history. */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /** Clear conversation history (keeps system prompt). */
  clearHistory(): void {
    this.history = [];
    this.currentSessionId = null;
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the system prompt with fresh context and replace it in history.
   * Called at the start of every chat() / chatStream() turn.
   */
  private async refreshSystemPrompt(): Promise<void> {
    const contextSnapshot = this.contextProvider ? await this.contextProvider() : '';
    const systemContent = buildSystemPrompt(contextSnapshot, this.provider, this.locale);

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

  private resolveSessionId(sessionId?: string): string {
    return sessionId ?? DEFAULT_CHANNEL_SESSION_ID;
  }

  private getModelName(): string {
    const modelMeta = this.model as { modelId?: string; model?: string };
    return modelMeta.modelId ?? modelMeta.model ?? 'unknown';
  }

  private logUsageSafe(params: Parameters<typeof logAiUsage>[1]): void {
    try {
      logAiUsage(this.db, params);
    } catch (error) {
      log.warn({ error }, 'Failed to persist AI usage log entry');
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.lockPromise;
    this.lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export type { AgentResponse, ToolResult, ChatStreamEvent } from '../types/agent-events.js';
