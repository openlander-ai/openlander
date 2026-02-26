/**
 * IME (Input Method Editor) utilities for CJK text input in terminal.
 *
 * When raw mode is enabled, terminal IME composition is bypassed and
 * multi-byte characters arrive as rapid sequences of bytes.  We use a
 * short flush delay so that related bytes are coalesced into a single
 * insert operation, preventing partial/garbled characters.
 */

/**
 * Flush delay (ms) for IME buffering.
 *
 * Multi-byte IME input (Korean, Chinese, Japanese) arrives as a burst of
 * bytes within ~10-20 ms.  50 ms is long enough to capture the full
 * sequence but short enough to feel instantaneous.
 *
 * Reference: Ink PR #865 uses the same value.
 */
export const IME_FLUSH_DELAY_MS = 50;

/**
 * Detect whether `input` is likely an IME / multi-byte character sequence.
 *
 * Returns `true` when:
 * - The string contains characters whose UTF-8 encoding is wider than 1 byte, OR
 * - The string matches CJK / combining-mark Unicode ranges.
 *
 * Returns `false` for plain ASCII (a-z, 0-9, symbols) so they can be
 * handled without the 50 ms buffer delay.
 */
export function isIMEInput(input: string): boolean {
  if (!input) return false;

  // Single ASCII character — definitely not IME.
  if (input.length === 1 && input.charCodeAt(0) < 128) return false;

  // Multi-byte UTF-8 (byte length > JS string length) → likely CJK/emoji.
  if (Buffer.byteLength(input, 'utf8') > input.length) return true;

  // Explicit CJK & combining-mark ranges:
  //   U+0300–U+036F  Combining Diacritical Marks
  //   U+3000–U+303F  CJK Symbols and Punctuation
  //   U+3040–U+309F  Hiragana
  //   U+30A0–U+30FF  Katakana
  //   U+4E00–U+9FFF  CJK Unified Ideographs
  //   U+AC00–U+D7AF  Hangul Syllables
  //   U+F900–U+FAFF  CJK Compatibility Ideographs
  //   U+1100–U+11FF  Hangul Jamo
  //   U+3130–U+318F  Hangul Compatibility Jamo
  return /[\u0300-\u036F\u1100-\u11FF\u3000-\u303F\u3040-\u30FF\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(
    input,
  );
}

/**
 * Return the **display width** of a string in a monospace terminal.
 *
 * CJK "fullwidth" characters occupy 2 columns; everything else occupies 1.
 * This is a lightweight approximation — it does not account for every
 * edge-case in UAX #11, but it is accurate for common Korean, Chinese,
 * and Japanese text as well as Latin/ASCII.
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0;
    if (
      // CJK Unified Ideographs
      (code >= 0x4e00 && code <= 0x9fff) ||
      // CJK Unified Ideographs Extension A
      (code >= 0x3400 && code <= 0x4dbf) ||
      // CJK Compatibility Ideographs
      (code >= 0xf900 && code <= 0xfaff) ||
      // Hangul Syllables
      (code >= 0xac00 && code <= 0xd7af) ||
      // Fullwidth Forms
      (code >= 0xff01 && code <= 0xff60) ||
      // CJK Symbols and Punctuation
      (code >= 0x3000 && code <= 0x303f) ||
      // Hiragana
      (code >= 0x3040 && code <= 0x309f) ||
      // Katakana
      (code >= 0x30a0 && code <= 0x30ff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}
