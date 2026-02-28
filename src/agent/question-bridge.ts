/**
 * QuestionBridge — Async bridge between the agent (tool execution) and the TUI.
 *
 * When the LLM calls `ask_user_question`, the tool creates a Promise via this bridge.
 * The agentic loop pauses on `await bridge.ask(...)`.
 * The TUI renders the question and calls `bridge.reply(answers)` when the user responds.
 * The Promise resolves and the tool returns the answers to the LLM.
 *
 * Data flow:
 *   [LLM] → ask_user_question tool → bridge.ask() → Promise (pauses loop)
 *     → [TUI] renders QuestionDock → user picks → bridge.reply()
 *       → Promise resolves → tool returns answers → [LLM] continues
 */

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

  /**
   * Register the TUI handler that will render questions.
   * Called once at startup when wiring TUI ↔ agent.
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
      this.onQuestion?.(request);
    });
  }

  /**
   * Called by the TUI when the user submits their answers.
   * Resolves the pending Promise, resuming the agentic loop.
   */
  reply(answers: QuestionAnswer[]): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.(answers);
  }

  /**
   * Called by the TUI when the user dismisses/cancels the question.
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
