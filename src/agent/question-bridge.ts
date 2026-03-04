/**
 * QuestionBridge — Async bridge between the agent (tool execution) and the UI.
 *
 * When the LLM calls `ask_user_question`, the tool creates a Promise via this bridge.
 * The agentic loop pauses on `await bridge.ask(...)`.
 * The UI (TUI or web) renders the question and calls `bridge.reply(answers)` when the user responds.
 * The Promise resolves and the tool returns the answers to the LLM.
 *
 * Data flow:
 *   [LLM] → ask_user_question tool → bridge.ask() → Promise (pauses loop)
 *     → [UI] renders question → user picks → bridge.reply()
 *       → Promise resolves → tool returns answers → [LLM] continues
 *
 * v0.1: Also emits `question:pending` via EventBus so the web build stream
 *       can forward questions to the frontend timeline.
 */

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

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class QuestionBridge {
  private pendingResolve: ((answers: QuestionAnswer[]) => void) | null = null;
  private onQuestion: ((request: QuestionRequest) => void) | null = null;
  private eventBus: EventBus | null = null;
  private activeProjectId: string | null = null;

  /**
   * Attach the EventBus so question events are broadcast to stream listeners.
   * Called once at startup in createAppContext().
   */
  setEventBus(bus: EventBus): void {
    this.eventBus = bus;
  }

  /**
   * Set the project ID for the currently active deploy.
   * Called before each deploy so question events carry the right projectId.
   */
  setActiveProject(projectId: string | null): void {
    this.activeProjectId = projectId;
  }

  /**
   * Register the TUI/UI handler that will render questions.
   * Called once at startup when wiring UI ↔ agent.
   */
  setQuestionHandler(handler: (request: QuestionRequest) => void): void {
    this.onQuestion = handler;
  }

  /**
   * Called by the ask_user_question tool.
   * Returns a Promise that pauses the agentic loop until the user responds.
   */
  ask(request: QuestionRequest): Promise<QuestionAnswer[]> {
    return new Promise<QuestionAnswer[]>((resolve) => {
      this.pendingResolve = resolve;

      // Broadcast to EventBus so the web build stream can pick it up
      if (this.eventBus && this.activeProjectId) {
        void this.eventBus.emit('question:pending', {
          projectId: this.activeProjectId,
          requestId: request.id,
          questions: request.questions,
        });
      }

      this.onQuestion?.(request);
    });
  }

  /**
   * Called by the UI when the user submits their answers.
   * Resolves the pending Promise, resuming the agentic loop.
   */
  reply(answers: QuestionAnswer[]): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;

    // Broadcast answer event
    if (this.eventBus && this.activeProjectId) {
      void this.eventBus.emit('question:answered', {
        projectId: this.activeProjectId,
        requestId: '', // We don't track requestId in reply — best-effort
      });
    }

    resolve?.(answers);
  }

  /**
   * Called by the UI when the user dismisses/cancels the question.
   * Resolves with empty answers so the LLM knows the user declined.
   */
  reject(): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.([]);
  }

  /** Check if there is a pending question awaiting user response. */
  hasPending(): boolean {
    return this.pendingResolve !== null;
  }
}
