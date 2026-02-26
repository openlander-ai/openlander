/**
 * Lightweight markdown parser for TUI rendering.
 *
 * Parses a subset of markdown into structured tokens that can be
 * rendered by @opentui/solid components. Supports:
 * - Headers (# ## ###)
 * - Bold (**text**)
 * - Inline code (`code`)
 * - Code blocks (```lang ... ```)
 * - Lists (- item, * item, 1. item)
 * - Horizontal rules (---, ***)
 * - Links [text](url) → renders url in secondary color
 * - Paragraphs (separated by blank lines)
 */

export type MarkdownToken =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'code_block'; language: string; code: string }
  | { type: 'list_item'; ordered: boolean; index: number; spans: InlineSpan[] }
  | { type: 'hr' };

export type InlineSpan =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string };

/**
 * Parse markdown string into a list of block tokens.
 */
export function parseMarkdown(input: string): MarkdownToken[] {
  const lines = input.split('\n');
  const tokens: MarkdownToken[] = [];
  let i = 0;

  const getLine = (): string => lines[i] ?? '';

  while (i < lines.length) {
    const line = getLine();

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      tokens.push({
        type: 'heading',
        level: (level <= 3 ? level : 3) as 1 | 2 | 3,
        text: (headingMatch[2] ?? '').trim(),
      });
      i++;
      continue;
    }

    // Code block
    const codeBlockMatch = line.match(/^```(\w*)$/);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !getLine().startsWith('```')) {
        codeLines.push(getLine());
        i++;
      }
      if (i < lines.length) i++; // Skip closing ```
      tokens.push({
        type: 'code_block',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      tokens.push({
        type: 'list_item',
        ordered: false,
        index: 0,
        spans: parseInline(ulMatch[2] ?? ''),
      });
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      tokens.push({
        type: 'list_item',
        ordered: true,
        index: parseInt(olMatch[2] ?? '0', 10),
        spans: parseInline(olMatch[3] ?? ''),
      });
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pLine = getLine();
      if (
        pLine.trim() === '' ||
        /^#{1,3}\s/.test(pLine) ||
        pLine.startsWith('```') ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(pLine) ||
        /^(\s*)[-*]\s+/.test(pLine) ||
        /^(\s*)\d+\.\s+/.test(pLine)
      ) {
        break;
      }
      paraLines.push(pLine);
      i++;
    }
    if (paraLines.length > 0) {
      tokens.push({
        type: 'paragraph',
        spans: parseInline(paraLines.join(' ')),
      });
    }
  }

  return tokens;
}

/**
 * Parse inline markdown (bold, code, links) into spans.
 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  // Regex to match: **bold**, `code`, [text](url)
  const pattern = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      spans.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2] !== undefined) {
      // Bold: **text**
      spans.push({ type: 'bold', text: match[2] });
    } else if (match[3] !== undefined) {
      // Inline code: `code`
      spans.push({ type: 'code', text: match[3] });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Link: [text](url)
      spans.push({ type: 'link', text: match[4], url: match[5] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    spans.push({ type: 'text', text: text.slice(lastIndex) });
  }

  // If no spans at all, return the full text
  if (spans.length === 0) {
    spans.push({ type: 'text', text });
  }

  return spans;
}
