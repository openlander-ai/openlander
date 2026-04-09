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

function syntaxHighlightHTML(html: string): string {
  let res = html;

  // Highlight ISO Dates/Times (e.g. 2026-04-09 18:12:56.867)
  res = res.replace(/\b(\d{4}-\d{2}-\d{2}[ T]?\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g, (match) => {
    return `<span class="text-[hsl(var(--muted-foreground))]/70">${match}</span>`;
  });

  // Highlight IPs (IPv4)
  res = res.replace(/(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\:\d{1,5})?(?!\d)/g, (match) => {
    return `<span class="text-sky-400/80">${match}</span>`;
  });

  // Highlight HTTP Methods
  res = res.replace(/(?<=\"|\b)(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)(?=\s)/g, (match) => {
    switch (match) {
      case 'GET': return '<span class="text-sky-400 font-semibold border border-sky-400/20 bg-sky-400/10 px-1 rounded">GET</span>';
      case 'POST': return '<span class="text-emerald-400 font-semibold border border-emerald-400/20 bg-emerald-400/10 px-1 rounded">POST</span>';
      case 'PUT':
      case 'PATCH': return '<span class="text-amber-400 font-semibold border border-amber-400/20 bg-amber-400/10 px-1 rounded">' + match + '</span>';
      case 'DELETE': return '<span class="text-rose-400 font-semibold border border-rose-400/20 bg-rose-400/10 px-1 rounded">DELETE</span>';
      default: return '<span class="text-purple-400 font-semibold border border-purple-400/20 bg-purple-400/10 px-1 rounded">' + match + '</span>';
    }
  });

  // Highlight HTTP Status Codes
  res = res.replace(/(?<=\s|^|\")(2\d{2}|3\d{2}|4\d{2}|5\d{2})(?=\s|$|\")/g, (match) => {
    const code = parseInt(match, 10);
    if (code >= 200 && code < 300) return `<span class="text-emerald-500 font-bold">${match}</span>`;
    if (code >= 300 && code < 400) return `<span class="text-sky-500 font-bold">${match}</span>`;
    if (code >= 400 && code < 500) return `<span class="text-amber-500 font-bold">${match}</span>`;
    if (code >= 500) return `<span class="text-rose-500 font-bold">${match}</span>`;
    return match;
  });

  // Highlight URL paths inside HTTP requests (e.g. GET /api/v1/feed HTTP/1.1)
  // Uses a non-capturing group to make sure we don't accidentally match style="..." blocks. 
  // It matches a space, a forward slash followed by non-space/quote chars, ending with space HTTP.
  res = res.replace(/(\s)(\/[^\s"&]+)(\sHTTP\/(?:1\.1|2|3|\d(?:\.\d)?))/ig, '$1<span class="text-primary-ol/70 italic">$2</span>$3');

  // Highlight Log Levels (INFO, ERROR, WARN, DEBUG)
  res = res.replace(/(?<=\b|\[)(INFO|ERROR|WARN|WARNING|DEBUG|TRACE)(?=\]|\:|\s)/g, (match) => {
    switch (match) {
      case 'INFO': return '<span class="text-sky-400">INFO</span>';
      case 'ERROR': return '<span class="text-rose-400 font-bold">ERROR</span>';
      case 'WARN':
      case 'WARNING': return '<span class="text-amber-400 font-bold">' + match + '</span>';
      case 'DEBUG':
      case 'TRACE': return '<span class="text-[hsl(var(--muted-foreground))]">' + match + '</span>';
      default: return match;
    }
  });

  return res;
}

/** Render a log line as HTML while dropping broken ANSI fragments. */
export function parseAnsiLine(line: string): string {
  const baseHtml = converter.toHtml(sanitizeAnsiText(line, true));
  return syntaxHighlightHTML(baseHtml);
}

/** Extract plain text from ANSI-colored log output. */
export function stripAnsi(line: string): string {
  return normalizeControlCharacters(sanitizeAnsiText(line, false));
}

/** Normalize log text for search, filtering, and level detection. */
export function normalizeLogText(line: string): string {
  return stripAnsi(line).trimEnd();
}
