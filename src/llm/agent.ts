import { generateText, streamText, stepCountIs } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import type { ChatMessage } from './index.js';
import type { QuestionRequest, QuestionBridge } from '../lib/question-bridge.js';
import { runWithQuestionHandler } from '../lib/question-bridge.js';
import type { Database } from '../db/index.js';
import { buildSystemPrompt, type ContextProvider, type LLMProvider } from './prompts.js';
import type { ContextScope } from './context-assembler.js';
import { createModuleLogger } from '../lib/logger.js';
import { calculateCost, extractUsageFromResult } from './transparency.js';
import { withTracking } from './tracking-middleware.js';
import type { AgentResponse, ToolResult, ChatStreamEvent } from '../types/agent-events.js';
import { compactHistory } from './compaction.js';
import { decisionEngine } from './decision.js';
import type { ApprovalGate } from '../pipeline/approval-gate.js';
import { eventBus } from '../events/index.js';
import { classifyLlmError, LlmErrorType } from './llm-error-types.js';

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
  private currentScope?: ContextScope;
  private lockPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly model: LanguageModel,
    private readonly db: Database,
    private readonly contextProvider?: ContextProvider,
    private readonly provider: LLMProvider = 'gemini',
    private readonly locale: string = 'en',
    private readonly actionType: 'web_agent' | 'auto_recovery' = 'web_agent',
    private readonly approvalGate?: ApprovalGate,
  ) {}

  /** Set the question bridge for ask_user_question tool support. */
  setQuestionBridge(bridge: QuestionBridge): void {
    this.questionBridge = bridge;
  }

  /** Expose the agent's QuestionBridge (or null when not wired). */
  getQuestionBridge(): QuestionBridge | null {
    return this.questionBridge;
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

      const result = await withTracking(
        {
          projectId: this.currentScope?.projectId,
          sessionId: resolvedSessionId,
          actionType: this.actionType,
          source: this.actionType === 'auto_recovery' ? 'auto-recovery' : 'web',
        },
        () =>
          generateText({
            model: this.model,
            messages: this.history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            tools: this.buildGuardedTools(() => Promise.resolve()),
            stopWhen: stepCountIs(MAX_TOOL_STEPS),
          }),
      );

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
      await this.compactAndTrim();

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
    await this.compactAndTrim();
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
    scope?: ContextScope,
  ): Promise<void> {
    return this.withLock(async () => {
      this.currentScope = scope;
      const resolvedSessionId = this.resolveSessionId(sessionId);
      if (resolvedSessionId !== this.currentSessionId) {
        await this.switchSession(resolvedSessionId);
      } else {
        // Rebuild system prompt with fresh context
        await this.refreshSystemPrompt();
      }

      let actionRunId: string | undefined;

      if (this.actionType === 'web_agent') {
        actionRunId = this.db.createActionRun({
          projectId: sessionId ?? 'web_agent',
          triggerSource: 'web_agent',
          triggerSessionId: sessionId,
        });
      }

      await onEvent({ type: 'session', sessionId: resolvedSessionId, actionRunId });

      this.history.push({ role: 'user', content: userMessage });

      await onEvent({ type: 'thinking' });

      // 1.0 GA: install a STREAM-SCOPED question handler so two concurrent
      // chatStream calls do not trample each other. The handler propagates
      // through async tool execution via AsyncLocalStorage and the
      // `ask_user_question` tool reads it (`getActiveQuestionHandler`) at
      // ask-time. The legacy global `setQuestionHandler` is only used by
      // non-agent flows (deploy-failure-handler, domain-routes) now.
      const streamQuestionHandler = (request: QuestionRequest): void => {
        void onEvent({ type: 'question', request });
      };

      const allToolResults: ToolResult[] = [];
      let responseText = '';
      const startedAt = Date.now();
      const projectId = scope?.projectId;
      const modelName = this.getModelName();
      const source = this.actionType;
      let didStreamFail = false;
      let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      let currentStepIndex = 0;
      let lastToolName: string | undefined;

      const guardedTools = this.buildGuardedTools(onEvent, actionRunId);

      if (projectId) {
        await eventBus.emit('ai:invoked', {
          projectId,
          source,
          model: modelName,
          action: 'chatStream',
          correlationId: projectId,
        });
      }

      try {
        const result = await withTracking(
          {
            projectId: scope?.projectId,
            sessionId: resolvedSessionId,
            actionType: this.actionType,
            source: this.actionType === 'auto_recovery' ? 'auto-recovery' : 'web',
          },
          () =>
            // Bind the per-stream UI handler into AsyncLocalStorage so the
            // `ask_user_question` tool — which is shared across all streams
            // — can pick THIS stream's callback when it calls bridge.ask().
            runWithQuestionHandler(streamQuestionHandler, () =>
              Promise.resolve(
                streamText({
                  model: this.model,
                  messages: this.history.map((m) => ({
                    role: m.role,
                    content: m.content,
                  })),
                  tools: guardedTools,
                  maxRetries: 1,
                  stopWhen: stepCountIs(MAX_TOOL_STEPS),
                }),
              ),
            ),
        );

        streamLoop: for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta': {
              responseText += part.text;
              break;
            }
            case 'reasoning-delta': {
              await onEvent({ type: 'reasoning', content: part.text });
              break;
            }
            case 'tool-call': {
              lastToolName = part.toolName;
              await onEvent({
                type: 'tool_call',
                toolName: part.toolName,
                arguments: part.input as Record<string, unknown>,
                stepIndex: currentStepIndex,
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
              await onEvent({ type: 'tool_result', ...toolResult, stepIndex: currentStepIndex });
              break;
            }
            case 'tool-error': {
              const errorResult: ToolResult = {
                toolName: part.toolName,
                success: false,
                error: part.error instanceof Error ? part.error.message : String(part.error),
              };
              allToolResults.push(errorResult);
              await onEvent({ type: 'tool_result', ...errorResult, stepIndex: currentStepIndex });
              break;
            }
            case 'finish-step': {
              currentStepIndex++;
              if (actionRunId) {
                this.db.updateActionRunStep(actionRunId, currentStepIndex);
              }
              await onEvent({
                type: 'step_progress',
                step: currentStepIndex,
                toolName: lastToolName,
              });
              lastToolName = undefined;
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
        const errorType = classifyLlmError(error);
        const isRateLimit =
          errorType === LlmErrorType.RATE_LIMIT || errorType === LlmErrorType.QUOTA_EXHAUSTED;
        const errMsg = isRateLimit
          ? `LLM rate limit exceeded. Please wait a moment and try again. (${rawMsg})`
          : rawMsg;
        await onEvent({ type: 'error', error: errMsg });
        didStreamFail = true;
      } finally {
        if (projectId) {
          await eventBus.emit('ai:completed', {
            projectId,
            source,
            model: modelName,
            action: 'chatStream',
            correlationId: projectId,
            durationMs: Date.now() - startedAt,
            inputTokens: usage.inputTokens || undefined,
            outputTokens: usage.outputTokens || undefined,
            success: !didStreamFail,
          });
        }
      }

      if (didStreamFail) {
        if (actionRunId) {
          this.db.updateActionRunStatus(actionRunId, 'failed', 'Agent stream execution failed');
        }
        return;
      }

      const finalText =
        responseText ||
        '⚠️ Reached the maximum number of steps. Here is what was completed so far.';

      // Update history with the final response
      this.history.push({ role: 'assistant', content: finalText });
      await this.compactAndTrim();

      await onEvent({ type: 'message', content: finalText });

      if (actionRunId) {
        this.db.updateActionRunStatus(actionRunId, 'succeeded');
      }

      const costUsd = calculateCost(
        this.provider,
        modelName,
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
    const contextSnapshot = this.contextProvider
      ? await this.contextProvider(this.currentScope)
      : '';
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
  private async compactAndTrim(): Promise<void> {
    if (this.history.length <= MAX_HISTORY_MESSAGES) {
      return;
    }

    const system: ChatMessage = this.history[0] ?? { role: 'system', content: '' };
    const recent = this.history.slice(-KEEP_RECENT);
    const messagesToCompact = this.history.slice(1, -KEEP_RECENT);

    try {
      const summary = await compactHistory(this.model, messagesToCompact);
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: summary.startsWith('[Summary]') ? summary : `[Summary] ${summary}`,
      };
      this.history = [system, summaryMessage, ...recent];
      return;
    } catch (err) {
      log.warn({ err }, 'Compaction failed, falling back to simple trim');
    }

    const trimmed = this.history.length - MAX_HISTORY_MESSAGES;

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

  private buildGuardedTools(
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    actionRunId?: string,
  ): ToolSet {
    const guardedTools: ToolSet = {};

    const toText = (value: unknown): string => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return 'unknown';
    };

    for (const [name, toolDef] of Object.entries(this.tools)) {
      type ExecuteFn = (args: Record<string, unknown>, options: unknown) => unknown;

      const originalExecute = (toolDef as { execute?: ExecuteFn }).execute;

      guardedTools[name] = {
        ...toolDef,
        execute: async (args: Record<string, unknown>, options: unknown) => {
          const decision = decisionEngine.classify(name);

          if (
            decision === 'REQUIRE_APPROVAL' &&
            this.actionType === 'web_agent' &&
            this.approvalGate &&
            actionRunId
          ) {
            await onEvent({
              type: 'approval_required',
              actionRunId,
              toolName: name,
              toolArgs: args,
            });

            this.db.updateActionRunStatus(actionRunId, 'pending_approval');
            this.db.updateActionRunApproval(actionRunId, 'pending', name);

            const approvalResult = await this.approvalGate.waitForApproval(actionRunId, {
              projectId: toText(args['project_id'] ?? args['projectId']),
              projectName: toText(args['project_name'] ?? args['projectName']),
              toolName: name,
              attempt: 1,
              actionRunId,
              createdAt: new Date(),
            });

            if (approvalResult !== 'approved') {
              const reason =
                approvalResult === 'timed_out'
                  ? 'Approval timed out for this action'
                  : 'User rejected the action';
              this.db.updateActionRunStatus(actionRunId, 'failed', reason);
              this.db.updateActionRunApproval(actionRunId, 'rejected', name);
              return {
                error: approvalResult === 'timed_out' ? 'ACTION_TIMED_OUT' : 'ACTION_REJECTED',
                message: reason,
              };
            }

            this.db.updateActionRunStatus(actionRunId, 'running');
            this.db.updateActionRunApproval(actionRunId, 'approved', name);
          } else if (decision === 'NOTIFY_THEN_ALLOW') {
            await onEvent({
              type: 'notification',
              toolName: name,
              message: `Executing ${name}...`,
            });
          }

          if (!originalExecute) {
            return null;
          }

          return originalExecute(args, options);
        },
      };
    }

    return guardedTools;
  }

  private getModelName(): string {
    const modelMeta = this.model as { modelId?: string; model?: string };
    return modelMeta.modelId ?? modelMeta.model ?? 'unknown';
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
