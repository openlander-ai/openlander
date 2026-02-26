import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Border helpers
// ---------------------------------------------------------------------------

/** All-space border chars — spread as base for partial borders. */
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

/** Textarea key bindings: Enter → submit, Shift+Enter → newline. */
const textareaKeyBindings: Array<{ name: string; action: string; shift?: boolean }> = [
  { name: 'enter', action: 'submit' },
  { name: 'enter', shift: true, action: 'newline' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal interface for reading textarea content via ref. */
interface TextareaRef {
  readonly plainText: string;
}

export interface PromptProps {
  /** Whether the prompt box is visible. Defaults to true. */
  visible?: boolean;
  /** Whether the textarea receives focus. */
  focused?: boolean;
  /** Placeholder text shown when textarea is empty. */
  placeholder?: string;
  /** Agent display name. */
  agentName?: string;
  /** Model display name. */
  modelName?: string;
  /** Provider display name. */
  providerName?: string;
  /** Dims the textarea text when true. */
  isStreaming?: boolean;
  /** Called when the user presses Enter to submit. */
  onSubmit?: () => void;
  /** Called on every text change with the current content string. */
  onContentChange?: (text: string) => void;
  /** Called on key down before textarea processes the key. */
  onKeyDown?: (event: unknown) => void;
  /** Callback to receive the textarea renderable ref for external control. */
  textareaRef?: (ref: unknown) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OpenCode-style prompt component.
 *
 * Visual structure:
 * ┃  [multiline textarea]
 * ┃  Agent  model  provider
 * ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 */
export function Prompt(props: PromptProps): JSX.Element {
  let localRef: TextareaRef | null = null;
  const borderColor = () => theme.primary;

  return (
    <box visible={props.visible !== false}>
      {/* Left colored border + input body */}
      <box
        border={['left']}
        borderColor={borderColor()}
        customBorderChars={{
          ...EmptyBorder,
          vertical: '┃',
          bottomLeft: '╹',
        }}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
        >
          {/* Multiline textarea (1–6 lines) */}
          <textarea
            placeholder={props.placeholder ?? 'Ask anything... (/help for commands)'}
            textColor={props.isStreaming ? theme.textMuted : theme.text}
            focusedTextColor={props.isStreaming ? theme.textMuted : theme.text}
            minHeight={1}
            maxHeight={6}
            focused={props.focused}
            keyBindings={textareaKeyBindings}
            onSubmit={() => props.onSubmit?.()}
            onContentChange={() => {
              props.onContentChange?.(localRef?.plainText ?? '');
            }}
            onKeyDown={(e: unknown) => props.onKeyDown?.(e)}
            ref={(r: unknown) => {
              localRef = r as TextareaRef;
              props.textareaRef?.(r);
            }}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.text}
            wrapMode="word"
          />

          {/* Agent / model indicator row */}
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
            <text fg={borderColor()}>{props.agentName ?? 'Agent'} </text>
            <Show when={props.modelName}>
              <text flexShrink={0} fg={theme.text}>
                {props.modelName}
              </text>
            </Show>
            <Show when={props.providerName}>
              <text fg={theme.textMuted}>{props.providerName}</text>
            </Show>
          </box>
        </box>
      </box>

      {/* Bottom decoration: ╹ left cap + ▀ fill */}
      <box
        height={1}
        border={['left']}
        borderColor={borderColor()}
        customBorderChars={{
          ...EmptyBorder,
          vertical: '╹',
        }}
      >
        <box
          height={1}
          border={['bottom']}
          borderColor={theme.backgroundElement}
          customBorderChars={{
            ...EmptyBorder,
            horizontal: '▀',
          }}
        />
      </box>
    </box>
  );
}
