/**
 * IMETextInput — Drop-in replacement for `ink-text-input` with CJK IME support.
 *
 * In raw mode, multi-byte IME input (Korean ㄱ→가→간, Chinese pinyin, Japanese
 * romaji→kana) arrives as rapid byte sequences that `useInput` processes
 * one-at-a-time, causing garbled text.  This component buffers non-ASCII input
 * for 50 ms before flushing, coalescing the bytes into correct characters.
 *
 * ASCII input and control keys (arrows, backspace, enter) are processed
 * immediately with zero delay.
 *
 * API-compatible with `ink-text-input` — swap the import and it works.
 *
 * References:
 *   - Ink PR #865 (IME buffering approach)
 *   - Claude Code #22853, #27857 (same problem, Ink-based)
 *   - Gemini CLI KeypressContext (similar 50ms buffer)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, useInput } from 'ink';
import pc from 'picocolors';
import { isIMEInput, IME_FLUSH_DELAY_MS } from '../utils/ime.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IMETextInputProps {
  /** Current value (controlled component) */
  readonly value: string;
  /** Called when the value changes */
  readonly onChange: (value: string) => void;
  /** Called when Enter is pressed */
  readonly onSubmit?: (value: string) => void;
  /** Placeholder text shown when value is empty */
  readonly placeholder?: string;
  /** Whether the input is focused / accepts keystrokes */
  readonly focus?: boolean;
  /** Whether to render a fake cursor */
  readonly showCursor?: boolean;
  /** Mask character (e.g. '*' for password fields) */
  readonly mask?: string;
  /** Highlight pasted text (API compat — minimal impl) */
  readonly highlightPastedText?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IMETextInput({
  value: originalValue,
  placeholder = '',
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit,
}: IMETextInputProps): React.ReactElement {
  // --- Cursor state ---
  const [state, setState] = useState({
    cursorOffset: (originalValue || '').length,
    cursorWidth: 0,
  });
  const { cursorOffset, cursorWidth } = state;

  // --- IME buffer ---
  const imeBufferRef = useRef<string>('');
  const imeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to latest values so the flush callback sees current state.
  const valueRef = useRef(originalValue);
  const cursorOffsetRef = useRef(cursorOffset);

  useEffect(() => {
    valueRef.current = originalValue;
  }, [originalValue]);

  useEffect(() => {
    cursorOffsetRef.current = cursorOffset;
  }, [cursorOffset]);

  // --- Sync cursor on external value changes ---
  useEffect(() => {
    setState((prev) => {
      if (!focus || !showCursor) return prev;
      const newValue = originalValue || '';
      if (prev.cursorOffset > newValue.length) {
        return { cursorOffset: newValue.length, cursorWidth: 0 };
      }
      return prev;
    });
  }, [originalValue, focus, showCursor]);

  // --- Cleanup timer on unmount ---
  useEffect(() => {
    return () => {
      if (imeTimerRef.current) clearTimeout(imeTimerRef.current);
    };
  }, []);

  // --- Flush IME buffer: insert accumulated chars at cursor ---
  const flushIMEBuffer = useCallback(() => {
    const buffered = imeBufferRef.current;
    if (!buffered) return;
    imeBufferRef.current = '';

    const val = valueRef.current;
    const offset = cursorOffsetRef.current;

    const nextValue = val.slice(0, offset) + buffered + val.slice(offset);
    const nextOffset = offset + buffered.length;

    setState({ cursorOffset: nextOffset, cursorWidth: buffered.length > 1 ? buffered.length : 0 });
    onChange(nextValue);
  }, [onChange]);

  // --- Keyboard handler via Ink's useInput ---
  useInput(
    (input, key) => {
      // Ignore navigation keys that other hooks handle.
      if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab) {
        return;
      }

      // --- Enter → flush buffer synchronously, then submit with computed value ---
      if (key.return) {
        let submitValue = originalValue;
        if (imeBufferRef.current) {
          if (imeTimerRef.current) {
            clearTimeout(imeTimerRef.current);
            imeTimerRef.current = null;
          }
          const buffered = imeBufferRef.current;
          imeBufferRef.current = '';
          const offset = cursorOffsetRef.current;
          submitValue = originalValue.slice(0, offset) + buffered + originalValue.slice(offset);
          setState({
            cursorOffset: offset + buffered.length,
            cursorWidth: 0,
          });
          onChange(submitValue);
        }
        if (onSubmit) {
          onSubmit(submitValue);
        }
        return;
      }

      // For all editing keys, flush any pending IME buffer first.
      if (
        imeBufferRef.current &&
        (key.leftArrow || key.rightArrow || key.backspace || key.delete)
      ) {
        if (imeTimerRef.current) {
          clearTimeout(imeTimerRef.current);
          imeTimerRef.current = null;
        }
        flushIMEBuffer();
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;
      let nextCursorWidth = 0;

      if (key.leftArrow) {
        if (showCursor) nextCursorOffset--;
      } else if (key.rightArrow) {
        if (showCursor) nextCursorOffset++;
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset, originalValue.length);
          nextCursorOffset--;
        }
      } else if (input) {
        // --- Character input ---
        if (isIMEInput(input)) {
          // Multi-byte / CJK → buffer with 50ms delay.
          imeBufferRef.current += input;
          if (imeTimerRef.current) clearTimeout(imeTimerRef.current);
          imeTimerRef.current = setTimeout(() => {
            imeTimerRef.current = null;
            flushIMEBuffer();
          }, IME_FLUSH_DELAY_MS);
          return; // Don't update state yet — wait for flush.
        }

        // Plain ASCII → insert immediately (no delay).
        nextValue =
          originalValue.slice(0, cursorOffset) +
          input +
          originalValue.slice(cursorOffset, originalValue.length);
        nextCursorOffset += input.length;
        if (input.length > 1) {
          nextCursorWidth = input.length;
        }
      }

      // --- Clamp cursor ---
      if (nextCursorOffset < 0) nextCursorOffset = 0;
      if (nextCursorOffset > nextValue.length) nextCursorOffset = nextValue.length;

      setState({ cursorOffset: nextCursorOffset, cursorWidth: nextCursorWidth });
      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus },
  );

  // --- Rendering ---
  const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
  const value = mask ? mask.repeat(originalValue.length) : originalValue;

  let renderedValue = value;
  let renderedPlaceholder: string | undefined = placeholder ? pc.gray(placeholder) : undefined;

  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0
        ? pc.inverse(placeholder[0] ?? '') + pc.gray(placeholder.slice(1))
        : pc.inverse(' ');

    renderedValue = value.length > 0 ? '' : pc.inverse(' ');

    let i = 0;
    for (const char of value) {
      renderedValue +=
        i >= cursorOffset - cursorActualWidth && i <= cursorOffset ? pc.inverse(char) : char;
      i++;
    }

    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += pc.inverse(' ');
    }
  }

  return (
    <Text>
      {placeholder ? (value.length > 0 ? renderedValue : renderedPlaceholder) : renderedValue}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Uncontrolled variant (API compat)
// ---------------------------------------------------------------------------

export function UncontrolledIMETextInput({
  initialValue = '',
  ...props
}: Omit<IMETextInputProps, 'value' | 'onChange'> & {
  readonly initialValue?: string;
}): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  return <IMETextInput {...props} value={value} onChange={setValue} />;
}
