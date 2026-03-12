import { createSignal, createMemo, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { theme } from '../theme.js';
import type { QuestionRequest, QuestionAnswer, Question } from '../../agent/question-bridge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionDockProps {
  /** The question request from the agent bridge. */
  request: QuestionRequest;
  /** Whether this component has keyboard focus. */
  focused: boolean;
  /** Called when the user submits all answers. */
  onSubmit: (answers: QuestionAnswer[]) => void;
  /** Called when the user dismisses (cancels) the question. */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Index value for "type your own answer" option (appended after real options). */
const CUSTOM_OPTION_INDEX = -1;

/** All-space border chars — spread as base for pipe borders (matches Prompt.tsx). */
const EmptyBorder = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  horizontal: ' ',
  vertical: ' ',
  topT: ' ',
  bottomT: ' ',
  leftT: ' ',
  rightT: ' ',
  cross: ' ',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * QuestionDock — Renders structured questions from the LLM agent.
 *
 * Supports single-select (radio) and multi-select (checkbox) modes.
 * Last option is always "Type your own answer" (custom input).
 * Navigate with ↑/↓, select with Enter/Space, submit with Enter on footer.
 *
 * Layout:
 * ┌─ header ─────────────────── progress ┐
 * │  question text                        │
 * │  ● Option A (selected)               │
 * │    description                        │
 * │  ○ Option B                          │
 * │  ○ Type your own answer...           │
 * │  [input field if custom selected]    │
 * │  [Cancel]          [Back] [Submit]   │
 * └───────────────────────────────────────┘
 */
export function QuestionDock(props: QuestionDockProps): JSX.Element {
  // --- Multi-question navigation ---
  const [currentQuestionIndex, setCurrentQuestionIndex] = createSignal(0);

  const currentQuestion = createMemo((): Question => {
    const idx = currentQuestionIndex();
    const q = props.request.questions[idx];
    if (q) return q;
    const first = props.request.questions[0];
    if (!first) throw new Error('No questions available');
    return first;
  });
  const totalQuestions = () => props.request.questions.length;
  const isLastQuestion = () => currentQuestionIndex() >= totalQuestions() - 1;
  const isFirstQuestion = () => currentQuestionIndex() === 0;

  // --- Selection state (per question) ---
  // Store answers for all questions: Map<questionIndex, Set<optionIndex>>
  const [answersMap, setAnswersMap] = createSignal<Map<number, Set<number>>>(new Map());
  const [customTexts, setCustomTexts] = createSignal<Map<number, string>>(new Map());

  // Current question's selected options
  const selectedOptions = createMemo((): Set<number> => {
    return answersMap().get(currentQuestionIndex()) ?? new Set();
  });

  const customText = createMemo((): string => {
    return customTexts().get(currentQuestionIndex()) ?? '';
  });

  // --- Cursor (highlighted option index) ---
  // Options: 0..N-1 = real options, then one extra for custom input
  const optionCount = createMemo(() => currentQuestion().options.length + 1);
  const [cursorIndex, setCursorIndex] = createSignal(0);

  const isCustomHighlighted = () => cursorIndex() === currentQuestion().options.length;
  const isCustomSelected = () => selectedOptions().has(CUSTOM_OPTION_INDEX);

  // --- Editing state for custom input ---
  const [isEditingCustom, setIsEditingCustom] = createSignal(false);

  // ---------------------------------------------------------------------------
  // Selection logic
  // ---------------------------------------------------------------------------

  const toggleOption = (optionIndex: number) => {
    const qi = currentQuestionIndex();
    const isMultiple = currentQuestion().multiple ?? false;

    setAnswersMap((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(qi) ?? []);

      if (isMultiple) {
        // Multi-select: toggle
        if (current.has(optionIndex)) {
          current.delete(optionIndex);
        } else {
          current.add(optionIndex);
        }
      } else {
        // Single-select: replace
        current.clear();
        current.add(optionIndex);
      }

      next.set(qi, current);
      return next;
    });
  };

  const updateCustomText = (text: string) => {
    const qi = currentQuestionIndex();
    setCustomTexts((prev) => {
      const next = new Map(prev);
      next.set(qi, text);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Build final answers
  // ---------------------------------------------------------------------------

  const buildAnswers = (): QuestionAnswer[] => {
    const answers: QuestionAnswer[] = [];
    const questions = props.request.questions;

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      if (!q) continue;
      const selected = answersMap().get(qi) ?? new Set();
      const custom = customTexts().get(qi) ?? '';

      const selectedLabels: string[] = [];
      for (const idx of selected) {
        if (idx === CUSTOM_OPTION_INDEX) continue;
        const opt = q.options[idx];
        if (opt) selectedLabels.push(opt.label);
      }

      answers.push({
        questionIndex: qi,
        selectedLabels,
        customText: selected.has(CUSTOM_OPTION_INDEX) ? custom : undefined,
      });
    }

    return answers;
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goNext = () => {
    if (isLastQuestion()) {
      // Submit all answers
      props.onSubmit(buildAnswers());
    } else {
      setCurrentQuestionIndex((i) => i + 1);
      setCursorIndex(0);
      setIsEditingCustom(false);
    }
  };

  const goBack = () => {
    if (!isFirstQuestion()) {
      setCurrentQuestionIndex((i) => i - 1);
      setCursorIndex(0);
      setIsEditingCustom(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // ---------------------------------------------------------------------------

  useKeyboard((event) => {
    if (!props.focused) return;
    const evt = event as { name?: string; ctrl?: boolean; shift?: boolean };
    const key = evt.name ?? '';

    // If editing custom text, handle differently
    if (isEditingCustom()) {
      if (key === 'escape') {
        setIsEditingCustom(false);
        return;
      }
      if (key === 'enter' || key === 'return') {
        // Confirm custom text and move on
        setIsEditingCustom(false);
        if (customText().trim()) {
          toggleOption(CUSTOM_OPTION_INDEX);
        }
        return;
      }
      if (key === 'backspace') {
        updateCustomText(customText().slice(0, -1));
        return;
      }
      // Single character input
      if (key && key.length === 1) {
        updateCustomText(customText() + key);
        return;
      }
      if (key === 'space') {
        updateCustomText(customText() + ' ');
        return;
      }
      return;
    }

    // --- Normal navigation ---

    // Escape: dismiss
    if (key === 'escape') {
      props.onDismiss();
      return;
    }

    // Up: move cursor up
    if (key === 'up') {
      setCursorIndex((i) => Math.max(0, i - 1));
      return;
    }

    // Down: move cursor down
    if (key === 'down') {
      setCursorIndex((i) => Math.min(optionCount() - 1, i + 1));
      return;
    }

    // Space: toggle selection at cursor
    if (key === 'space') {
      if (isCustomHighlighted()) {
        setIsEditingCustom(true);
        toggleOption(CUSTOM_OPTION_INDEX);
      } else {
        toggleOption(cursorIndex());
      }
      return;
    }

    // Enter: select + advance (or submit on last question)
    if (key === 'enter' || key === 'return') {
      if (isCustomHighlighted()) {
        setIsEditingCustom(true);
        toggleOption(CUSTOM_OPTION_INDEX);
      } else {
        toggleOption(cursorIndex());
        goNext();
      }
      return;
    }

    // Tab / Shift+Tab: next/back question
    if (key === 'tab') {
      if (evt.shift) {
        goBack();
      } else {
        goNext();
      }
      return;
    }

    // Number keys: quick select
    if (key && /^[1-9]$/.test(key)) {
      const num = parseInt(key, 10) - 1;
      if (num < currentQuestion().options.length) {
        toggleOption(num);
        if (!(currentQuestion().multiple ?? false)) {
          goNext();
        }
      }
      return;
    }
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <box flexDirection="column" marginTop={1}>
      {/* Left pipe border container — matches Prompt.tsx style */}
      <box
        border={['left']}
        borderColor={theme.primary}
        customBorderChars={{ ...EmptyBorder, vertical: '┃' }}
      >
        <box flexDirection="column" paddingLeft={2} paddingRight={1}>
          {/* Header: question header + progress */}
          <box flexDirection="row" justifyContent="space-between">
            <text bold={true} fg={theme.primary}>
              {currentQuestion().header ?? 'Question'}
            </text>
            <Show when={totalQuestions() > 1}>
              <text fg={theme.textMuted}>
                {String(currentQuestionIndex() + 1)}/{String(totalQuestions())}
              </text>
            </Show>
          </box>

          {/* Question text */}
          <box marginBottom={1}>
            <text fg={theme.text}>{currentQuestion().question}</text>
          </box>

          {/* Options with numbered badges */}
          <For each={currentQuestion().options}>
            {(option, i) => {
              const isSelected = () => selectedOptions().has(i());
              const isHighlighted = () => cursorIndex() === i();
              const isMultiple = () => currentQuestion().multiple ?? false;
              const badge = () => String(i() + 1);
              const checkbox = () => (isSelected() ? '☑' : '☐');

              return (
                <box
                  flexDirection="column"
                  onMouseDown={() => {
                    setCursorIndex(i());
                    toggleOption(i());
                    if (!isMultiple()) goNext();
                  }}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={isHighlighted() ? theme.text : theme.textDim}>
                      {isHighlighted() ? '▸' : ' '}
                    </text>
                    <text
                      backgroundColor={isSelected() ? theme.primary : theme.backgroundElement}
                      fg={isSelected() ? theme.background : theme.warning}
                    >
                      {` ${badge()} `}
                    </text>
                    <Show when={isMultiple()}>
                      <text fg={isSelected() ? theme.primary : theme.textMuted}>{checkbox()}</text>
                    </Show>
                    <text
                      fg={
                        isSelected()
                          ? theme.primary
                          : isHighlighted()
                            ? theme.text
                            : theme.textMuted
                      }
                      bold={isSelected()}
                    >
                      {option.label}
                    </text>
                  </box>
                  <Show when={option.description}>
                    <box paddingLeft={6}>
                      <text fg={theme.textDim}>{option.description}</text>
                    </box>
                  </Show>
                </box>
              );
            }}
          </For>

          {/* Custom input option */}
          <box flexDirection="column">
            <box
              flexDirection="row"
              gap={1}
              onMouseDown={() => {
                setCursorIndex(currentQuestion().options.length);
                setIsEditingCustom(true);
                toggleOption(CUSTOM_OPTION_INDEX);
              }}
            >
              <text fg={isCustomHighlighted() ? theme.text : theme.textDim}>
                {isCustomHighlighted() ? '▸' : ' '}
              </text>
              <text
                backgroundColor={isCustomSelected() ? theme.primary : theme.backgroundElement}
                fg={isCustomSelected() ? theme.background : theme.accent}
              >
                {' * '}
              </text>
              <text
                fg={
                  isCustomSelected()
                    ? theme.primary
                    : isCustomHighlighted()
                      ? theme.text
                      : theme.textMuted
                }
                bold={isCustomSelected()}
              >
                Type your own answer...
              </text>
            </box>

            {/* Custom text input area with purple pipe accent */}
            <Show when={isEditingCustom() || (isCustomSelected() && customText())}>
              <box paddingLeft={4} flexDirection="row">
                <text fg={theme.accent}>┃ </text>
                <text fg={theme.text}>
                  {customText()}
                  <Show when={isEditingCustom()}>
                    <text fg={theme.accent}>▊</text>
                  </Show>
                </text>
              </box>
            </Show>
          </box>

          {/* Footer: StatusBar-style key hints */}
          <box flexDirection="row" gap={2} marginTop={1}>
            <box
              flexDirection="row"
              gap={0}
              onMouseDown={() => {
                props.onDismiss();
              }}
            >
              <text backgroundColor={theme.backgroundElement} fg={theme.text}>
                {' '}
                Esc{' '}
              </text>
              <text fg={theme.textMuted}> Cancel</text>
            </box>
            <Show when={!isFirstQuestion()}>
              <box
                flexDirection="row"
                gap={0}
                onMouseDown={() => {
                  goBack();
                }}
              >
                <text backgroundColor={theme.backgroundElement} fg={theme.text}>
                  {' '}
                  ⇧Tab{' '}
                </text>
                <text fg={theme.textMuted}> Back</text>
              </box>
            </Show>
            <box flexDirection="row" gap={0}>
              <text backgroundColor={theme.backgroundElement} fg={theme.text}>
                {' '}
                1-9{' '}
              </text>
              <text fg={theme.textMuted}> Select</text>
            </box>
            <box
              flexDirection="row"
              gap={0}
              onMouseDown={() => {
                goNext();
              }}
            >
              <text backgroundColor={theme.primary} fg={theme.background} bold={true}>
                {isLastQuestion() ? ' Submit ' : ' Next '}
              </text>
              <text fg={theme.textMuted}> Tab</text>
            </box>
          </box>
        </box>
      </box>
    </box>
  );
}
