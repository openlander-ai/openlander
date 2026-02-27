import { tokenize, SugarHigh } from 'sugar-high';
import { theme } from './theme.js';

export interface HighlightSpan {
  text: string;
  color: string;
}

const TOKEN_COLORS: Record<number, string> = {};

const typeNames = SugarHigh.TokenTypes as unknown as string[];
for (let i = 0; i < typeNames.length; i++) {
  const name = typeNames[i];
  switch (name) {
    case 'keyword':
      TOKEN_COLORS[i] = theme.secondary; // blue — if/else/const/function
      break;
    case 'string':
      TOKEN_COLORS[i] = theme.success; // green — "hello"
      break;
    case 'comment':
      TOKEN_COLORS[i] = theme.textDim; // dim — // comments
      break;
    case 'class':
      TOKEN_COLORS[i] = theme.warning; // orange — class names
      break;
    case 'property':
      TOKEN_COLORS[i] = theme.accent; // purple — .property
      break;
    case 'entity':
      TOKEN_COLORS[i] = theme.info; // cyan — entities
      break;
    case 'jsxliterals':
      TOKEN_COLORS[i] = theme.success; // green — JSX text
      break;
    case 'sign':
      TOKEN_COLORS[i] = theme.textMuted; // gray — {}[]()=
      break;
    case 'identifier':
      TOKEN_COLORS[i] = theme.text; // white — variable names
      break;
    case 'break':
    case 'space':
      TOKEN_COLORS[i] = theme.text; // default
      break;
  }
}

export function highlightCode(code: string, _language?: string): HighlightSpan[] {
  if (!code.trim()) {
    return [{ text: code, color: theme.accent }];
  }

  try {
    const tokens = tokenize(code);
    const spans: HighlightSpan[] = [];

    for (const [typeIdx, text] of tokens) {
      const color = TOKEN_COLORS[typeIdx] ?? theme.text;
      // Merge adjacent spans with the same color
      const last = spans[spans.length - 1];
      if (last && last.color === color) {
        last.text += text;
      } else {
        spans.push({ text, color });
      }
    }

    return spans.length > 0 ? spans : [{ text: code, color: theme.accent }];
  } catch {
    // Tokenization failed — fall back to plain text
    return [{ text: code, color: theme.accent }];
  }
}
