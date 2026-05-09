/**
 * QuestionBridge — Async bridge between the agent (tool execution) and the UI.
 *
 * When the LLM calls `ask_user_question`, the tool creates a Promise via this bridge.
 * The agentic loop pauses on `await bridge.ask(...)`.
 * The UI (web or CLI) renders the question and calls `bridge.reply(answers)` when the user responds.
 * The Promise resolves and the tool returns the answers to the LLM.
 *
 * Data flow:
 *   [LLM] → ask_user_question tool → bridge.ask() → Promise (pauses loop)
 *     → [UI] renders question → user picks → bridge.reply()
 *       → Promise resolves → tool returns answers → [LLM] continues
 *
 * v0.1: Also emits `question:pending` via EventBus so the web build stream
 *       can forward questions to the frontend timeline.
 *
 * v1.0 (concurrent deploys): Pending questions are tracked per `requestId` so
 *       multiple agents can be in-flight simultaneously without overwriting
 *       each other's resolve handler.
 *
 * v1.0 (stream-scoped handlers): `Agent.chatStream` runs each call inside an
 *       AsyncLocalStorage-bound handler context (`runWithQuestionHandler`)
 *       so the `ask_user_question` tool can pick up the right per-stream
 *       callback at execution time without overwriting the global handler.
 *       `setQuestionHandler` is preserved as a fallback for non-agent flows
 *       (deploy-failure-handler, domain-routes) that don't run inside an
 *       ALS context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { EventBus } from '../events/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  metadata?: Record<string, unknown>;
}

export interface QuestionRequest {
  id: string;
  questions: Question[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedLabels: string[];
  customText?: string;
}

const QUESTION_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const QUESTION_SESSION_TIMEOUT_MESSAGE =
  'Session timed out — user did not respond within 5 minutes';

type TimerApi = {
  setTimeout: (handler: () => void, timeout?: number) => unknown;
  clearTimeout: (timeoutId: unknown) => void;
};

const timerApi: TimerApi = globalThis as unknown as TimerApi;

interface PendingEntry {
  resolve: (answers: QuestionAnswer[]) => void;
  reject: (err: Error) => void;
  timeout: unknown;
  projectId: string | null;
}

/**
 * Per-stream question-handler context propagated through async tool execution
 * via `AsyncLocalStorage`. When `Agent.chatStream` runs the AI SDK tool loop
 * inside `runWithQuestionHandler`, the `ask_user_question` tool reads the
 * stream-scoped `handler` here and supplies it to `ask()` as an inline
 * handler — so two concurrent chat streams never trample each other's UI
 * callback (the prior `setQuestionHandler` global was last-write-wins).
 */
const questionHandlerStore = new AsyncLocalStorage<{
  handler: (request: QuestionRequest) => void;
}>();

export function runWithQuestionHandler<T>(
  handler: (request: QuestionRequest) => void,
  fn: () => T,
): T {
  return questionHandlerStore.run({ handler }, fn);
}

export function getActiveQuestionHandler(): ((request: QuestionRequest) => void) | undefined {
  return questionHandlerStore.getStore()?.handler;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class QuestionBridge {
  /**
   * Per-requestId pending entries so multiple agents can ask concurrently
   * without trampling each other's resolve handler.
   */
  private pending = new Map<string, PendingEntry>();
  private onQuestion: ((request: QuestionRequest) => void) | null = null;
  private eventBus: EventBus | null = null;
  private activeProjectId: string | null = null;

  private clearPendingTimeout(entry: PendingEntry): void {
    if (entry.timeout) {
      timerApi.clearTimeout(entry.timeout);
      entry.timeout = null;
    }
  }

  /**
   * Attach the EventBus so question events are broadcast to stream listeners.
   * Called once at startup in createAppContext().
   */
  setEventBus(bus: EventBus): void {
    this.eventBus = bus;
  }

  /**
   * Set the project ID for the currently active deploy.
   * Called before each deploy so question events carry the right projectId
   * when no inline projectId is supplied to `ask()`.
   *
   * Best-effort: with concurrent deploys this is overwritten; prefer passing
   * `projectId` directly via `ask({ projectId, ... })` (callers do this for
   * agent-driven flows).
   */
  setActiveProject(projectId: string | null): void {
    this.activeProjectId = projectId;
  }

  /**
   * Register the default UI handler that will render questions.
   *
   * Called at startup when wiring UI ↔ agent. Used as a fallback for
   * non-agent flows (deploy-failure-handler, domain-routes) that call
   * `ask()` without supplying an inline handler. Agents pass a per-call
   * handler via `ask({ handler })` so concurrent agent streams don't race
   * to overwrite this default.
   */
  setQuestionHandler(handler: (request: QuestionRequest) => void): void {
    this.onQuestion = handler;
  }

  /**
   * Called by the ask_user_question tool.
   * Returns a Promise that pauses the agentic loop until the user responds.
   *
   * @param request - QuestionRequest (must have a unique `id`).
   * @param options - Optional inline `handler` (preferred for agent flows, so
   *                  concurrent streams each get their own callback) and
   *                  optional `projectId` so the EventBus question:pending
   *                  payload carries the right project even when
   *                  `setActiveProject` is racy across concurrent deploys.
   */
  ask(
    request: QuestionRequest,
    options?: {
      handler?: (request: QuestionRequest) => void;
      projectId?: string;
    },
  ): Promise<QuestionAnswer[]> {
    return new Promise<QuestionAnswer[]>((resolve, reject) => {
      const projectId = options?.projectId ?? this.activeProjectId;
      const entry: PendingEntry = {
        resolve,
        reject,
        timeout: null,
        projectId,
      };
      entry.timeout = timerApi.setTimeout(() => {
        const current = this.pending.get(request.id);
        if (current === entry) {
          this.pending.delete(request.id);
        }
        reject(new Error(QUESTION_SESSION_TIMEOUT_MESSAGE));
      }, QUESTION_SESSION_TIMEOUT_MS);

      this.pending.set(request.id, entry);

      // Broadcast to EventBus so the web build stream can pick it up
      if (this.eventBus && projectId) {
        void this.eventBus.emit('question:pending', {
          projectId,
          requestId: request.id,
          questions: request.questions,
        });
      }

      const handler = options?.handler ?? this.onQuestion;
      handler?.(request);
    });
  }

  /**
   * Called by the UI when the user submits their answers.
   * Resolves the pending Promise, resuming the agentic loop.
   *
   * @param requestId - The question request ID — looked up against in-flight
   *                    pending entries so concurrent deploys can be answered
   *                    independently.
   * @param answers - User's selected answers.
   */
  reply(requestId: string, answers: QuestionAnswer[]): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }
    this.pending.delete(requestId);
    this.clearPendingTimeout(entry);

    if (this.eventBus && entry.projectId) {
      void this.eventBus.emit('question:answered', {
        projectId: entry.projectId,
        requestId,
      });
    }

    entry.resolve(answers);
  }

  /**
   * Called by the UI when the user dismisses/cancels the question.
   * Resolves with empty answers so the LLM knows the user declined.
   *
   * @param requestId - Optional explicit requestId. When omitted (legacy
   *                    callers like channels/base.ts), rejects ALL pending
   *                    entries — preserves prior single-slot semantics.
   */
  reject(requestId?: string): void {
    if (requestId) {
      const entry = this.pending.get(requestId);
      if (!entry) {
        return;
      }
      this.pending.delete(requestId);
      this.clearPendingTimeout(entry);
      entry.resolve([]);
      return;
    }

    // No requestId — clear every pending entry. Used by channel cleanup.
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      this.clearPendingTimeout(entry);
      entry.resolve([]);
    }
  }

  /**
   * Check if there is at least one pending question awaiting user response.
   */
  hasPending(requestId?: string): boolean {
    if (requestId) {
      return this.pending.has(requestId);
    }
    return this.pending.size > 0;
  }
}
