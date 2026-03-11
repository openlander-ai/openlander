import AnsiToHtml from 'ansi-to-html';

const converter = new AnsiToHtml({
  fg: '#d4d4d4',
  bg: 'transparent',
  newline: false,
  escapeXML: true,
});

const ESC = '\u001B';
const CSI = '\u009B';
const OSC = '\u009D';

const csiFinalByte = /^[\x40-\x7E]$/;
const escSequenceByte = /^[\x40-\x5F]$/;

function consumeOsc(text: string, start: number): number {
  const introducerSize = text[start] === ESC ? 2 : 1;
  let index = start + introducerSize;

  while (index < text.length) {
    const char = text[index];
    if (char === '\u0007') {
      return index + 1;
    }

    if (char === ESC && text[index + 1] === '\\') {
      return index + 2;
    }

    index += 1;
  }

  return text.length;
}

function consumeCsi(text: string, start: number): number {
  const introducerSize = text[start] === ESC ? 2 : 1;
  let index = start + introducerSize;

  while (index < text.length) {
    const char = text[index];
    if (csiFinalByte.test(char)) {
      return index + 1;
    }
    index += 1;
  }

  return text.length;
}

function normalizeControlCharacters(text: string): string {
  const chars: string[] = [];
  let lineStart = 0;
  let cursor = 0;

  for (const char of text) {
    if (char === '\n') {
      chars.push(char);
      lineStart = chars.length;
      cursor = chars.length;
      continue;
    }

    if (char === '\r') {
      cursor = lineStart;
      continue;
    }

    if (char === '\b') {
      cursor = Math.max(lineStart, cursor - 1);
      continue;
    }

    if (cursor === chars.length) {
      chars.push(char);
    } else {
      chars[cursor] = char;
    }

    cursor += 1;
  }

  return (
    chars
      .join('')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g, '')
  );
}

function sanitizeAnsiText(text: string, keepAnsi: boolean): string {
  let result = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === ESC) {
      const next = text[index + 1];

      if (next === '[') {
        const end = consumeCsi(text, index);
        if (keepAnsi && end > index + 2) {
          result += text.slice(index, end);
        }
        index = end;
        continue;
      }

      if (next === ']') {
        index = consumeOsc(text, index);
        continue;
      }

      if (next && escSequenceByte.test(next)) {
        if (keepAnsi) {
          result += text.slice(index, index + 2);
        }
        index += 2;
        continue;
      }

      index += 1;
      continue;
    }

    if (char === CSI) {
      const end = consumeCsi(text, index);
      index = end;
      continue;
    }

    if (char === OSC) {
      index = consumeOsc(text, index);
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

/** Render a log line as HTML while dropping broken ANSI fragments. */
export function parseAnsiLine(line: string): string {
  return converter.toHtml(sanitizeAnsiText(line, true));
}

/** Extract plain text from ANSI-colored log output. */
export function stripAnsi(line: string): string {
  return normalizeControlCharacters(sanitizeAnsiText(line, false));
}

/** Normalize log text for search, filtering, and level detection. */
export function normalizeLogText(line: string): string {
  return stripAnsi(line).trimEnd();
}
