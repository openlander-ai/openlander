/**
 * Syntax highlighting module for TUI code blocks.
 * Uses sugar-high for JS/TS tokenization with custom language support.
 */

import { tokenize, SugarHigh } from 'sugar-high';
import { python as pythonPreset, css as cssPreset } from 'sugar-high/presets';
import { theme } from './theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HighlightSpan {
  text: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Token Type Mappings (sugar-high token types to theme colors)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

const jsLikeLanguages = new Set(['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'node']);

const pythonLanguages = new Set(['python', 'py']);

const cssLanguages = new Set(['css', 'scss', 'sass', 'less']);

const bashLanguages = new Set(['bash', 'sh', 'shell', 'zsh', 'shellscript']);

const jsonLanguages = new Set(['json', 'jsonc', 'json5']);

const yamlLanguages = new Set(['yaml', 'yml']);

const htmlLanguages = new Set(['html', 'htm', 'xml', 'svg', 'markup']);

// ---------------------------------------------------------------------------
// Sugar-High Highlighter (JS/TS/JSX/TSX, Python, CSS)
// ---------------------------------------------------------------------------

function highlightWithSugarHigh(
  code: string,
  languageConfig?: { keywords: Set<string> },
): HighlightSpan[] {
  const tokens = tokenize(code, languageConfig);
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
}

// ---------------------------------------------------------------------------
// Simple Regex Tokenizers for Additional Languages
// ---------------------------------------------------------------------------

/**
 * Simple Bash tokenizer - highlights keywords, strings, comments, variables
 */
function highlightBash(code: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  // Bash keywords
  const keywords = new Set([
    'if',
    'then',
    'else',
    'elif',
    'fi',
    'for',
    'while',
    'do',
    'done',
    'case',
    'esac',
    'function',
    'return',
    'exit',
    'export',
    'source',
    'echo',
    'printf',
    'read',
    'cd',
    'pwd',
    'true',
    'false',
    'local',
    'declare',
    'readonly',
    'unset',
  ]);

  // Tokenize: strings (single/double), comments, variables, words
  const pattern =
    /(#.*$)|(\$[A-Za-z_][A-Za-z0-9_]*)|(\$?\{[^}]+\})|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/gm;

  let match;
  while ((match = pattern.exec(code)) !== null) {
    const [
      _fullMatch,
      comment,
      simpleVar,
      braceVar,
      doubleString,
      singleString,
      word,
      whitespace,
      punctuation,
    ] = match;

    if (comment) {
      spans.push({ text: comment, color: TOKEN_COLORS[8] ?? theme.textDim }); // comment
    } else if (simpleVar || braceVar) {
      const text = simpleVar ?? braceVar ?? '';
      spans.push({ text, color: TOKEN_COLORS[4] ?? theme.accent }); // property
    } else if (doubleString || singleString) {
      const text = doubleString ?? singleString ?? '';
      spans.push({
        text,
        color: TOKEN_COLORS[2] ?? theme.success,
      }); // string
    } else if (word) {
      const color = keywords.has(word)
        ? (TOKEN_COLORS[1] ?? theme.secondary)
        : (TOKEN_COLORS[0] ?? theme.text);
      spans.push({ text: word, color });
    } else if (whitespace) {
      spans.push({ text: whitespace, color: theme.text });
    } else if (punctuation) {
      spans.push({ text: punctuation, color: TOKEN_COLORS[7] ?? theme.textMuted }); // sign
    }
  }

  return spans.length > 0 ? spans : [{ text: code, color: theme.accent }];
}

/**
 * Simple JSON tokenizer - highlights keys, strings, numbers, booleans, null
 */
function highlightJSON(code: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  // Tokenize: strings (keys vs values), numbers, keywords, punctuation
  const pattern =
    /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*)|(true|false|null)|(\s+)|([{}[\],:])/g;

  let match;
  while ((match = pattern.exec(code)) !== null) {
    const [_fullMatch, keyString, _colon, valueString, number, keyword, whitespace, punctuation] =
      match;

    if (keyString !== undefined) {
      // Key (property name)
      spans.push({ text: keyString, color: TOKEN_COLORS[4] ?? theme.accent }); // property
    } else if (valueString !== undefined) {
      // String value
      spans.push({ text: valueString, color: TOKEN_COLORS[2] ?? theme.success }); // string
    } else if (number !== undefined) {
      spans.push({ text: number, color: TOKEN_COLORS[3] ?? theme.warning }); // class/number
    } else if (keyword !== undefined) {
      spans.push({ text: keyword, color: TOKEN_COLORS[1] ?? theme.secondary }); // keyword
    } else if (whitespace !== undefined) {
      spans.push({ text: whitespace, color: theme.text });
    } else if (punctuation !== undefined) {
      spans.push({ text: punctuation, color: TOKEN_COLORS[7] ?? theme.textMuted }); // sign
    }
  }

  return spans.length > 0 ? spans : [{ text: code, color: theme.accent }];
}

/**
 * Simple YAML tokenizer - highlights keys, strings, numbers, booleans, comments
 */
function highlightYAML(code: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  // YAML keywords
  const keywords = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']);

  // Process line by line for YAML
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      spans.push({ text: '\n', color: theme.text });
      continue;
    }

    // Check for comment-only line
    if (/^\s*#/.test(line)) {
      spans.push({ text: line, color: TOKEN_COLORS[8] ?? theme.textDim });
      if (i < lines.length - 1) spans.push({ text: '\n', color: theme.text });
      continue;
    }

    // Try to match key: value pattern
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx);
      const rest = line.slice(colonIdx);

      // Leading whitespace
      const keyMatch = key.match(/^(\s*)(-?\s*)(\S.*)$/);
      if (keyMatch) {
        if (keyMatch[1]) spans.push({ text: keyMatch[1], color: theme.text });
        if (keyMatch[2])
          spans.push({ text: keyMatch[2], color: TOKEN_COLORS[7] ?? theme.textMuted });
        if (keyMatch[3]) spans.push({ text: keyMatch[3], color: TOKEN_COLORS[4] ?? theme.accent });
      } else {
        spans.push({ text: key, color: TOKEN_COLORS[4] ?? theme.accent });
      }

      // Colon and value
      const valuePart = rest.slice(1);
      spans.push({ text: ':', color: TOKEN_COLORS[7] ?? theme.textMuted });

      if (valuePart) {
        // Check for inline comment
        const commentIdx = valuePart.indexOf('#');
        const value = commentIdx >= 0 ? valuePart.slice(0, commentIdx) : valuePart;
        const comment = commentIdx >= 0 ? valuePart.slice(commentIdx) : '';

        // Highlight value
        const val = value.trim();
        if (val) {
          if (/^".*"$/.test(val) || /^'.*'$/.test(val)) {
            spans.push({ text: value, color: TOKEN_COLORS[2] ?? theme.success });
          } else if (/^-?\d+\.?\d*$/.test(val)) {
            spans.push({ text: value, color: TOKEN_COLORS[3] ?? theme.warning });
          } else if (keywords.has(val.toLowerCase())) {
            spans.push({ text: value, color: TOKEN_COLORS[1] ?? theme.secondary });
          } else {
            spans.push({ text: value, color: TOKEN_COLORS[2] ?? theme.success });
          }
        } else {
          spans.push({ text: value, color: theme.text });
        }

        if (comment) {
          spans.push({ text: comment, color: TOKEN_COLORS[8] ?? theme.textDim });
        }
      }
    } else {
      // No colon - could be a list item or plain text
      if (/^\s*-/.test(line)) {
        const listMatch = line.match(/^(\s*-\s*)(.*)(#.*)?$/);
        if (listMatch) {
          if (listMatch[1])
            spans.push({ text: listMatch[1], color: TOKEN_COLORS[7] ?? theme.textMuted });
          if (listMatch[2])
            spans.push({ text: listMatch[2], color: TOKEN_COLORS[2] ?? theme.success });
          if (listMatch[3])
            spans.push({ text: listMatch[3], color: TOKEN_COLORS[8] ?? theme.textDim });
        } else {
          spans.push({ text: line, color: theme.text });
        }
      } else {
        spans.push({ text: line, color: theme.text });
      }
    }

    if (i < lines.length - 1) spans.push({ text: '\n', color: theme.text });
  }

  return spans.length > 0 ? spans : [{ text: code, color: theme.accent }];
}

/**
 * Simple HTML tokenizer - highlights tags, attributes, strings
 */
function highlightHTML(code: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  // Tokenize: comments, tags, attributes, strings
  const pattern = /([\s\S]*?)(<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9-]*)/g;

  let lastIdx = 0;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const [_full, before, tag] = match;

    if (before) {
      spans.push({ text: before, color: theme.text });
    }

    if (tag) {
      if (tag.startsWith('<!--')) {
        // Comment
        spans.push({ text: tag, color: TOKEN_COLORS[8] ?? theme.textDim });
      } else {
        // Tag - parse tag name and attributes
        const tagMatch = tag.match(/^(<\/?)?([A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/);
        if (tagMatch) {
          const open = tagMatch[1] ?? '';
          const tagName = tagMatch[2] ?? '';
          const rest = tagMatch[3] ?? '';
          spans.push({ text: open, color: TOKEN_COLORS[7] ?? theme.textMuted });
          spans.push({ text: tagName, color: TOKEN_COLORS[1] ?? theme.secondary });

          // Parse attributes in rest
          if (rest) {
            const attrPattern = /(\s+)([A-Za-z-]+)(=?)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')?/g;
            let attrMatch;
            while ((attrMatch = attrPattern.exec(rest)) !== null) {
              const space = attrMatch[1] ?? '';
              const attrName = attrMatch[2] ?? '';
              const eq = attrMatch[3] ?? '';
              const attrValue = attrMatch[4];
              spans.push({ text: space, color: theme.text });
              spans.push({ text: attrName, color: TOKEN_COLORS[4] ?? theme.accent });
              if (eq) spans.push({ text: eq, color: TOKEN_COLORS[7] ?? theme.textMuted });
              if (attrValue)
                spans.push({ text: attrValue, color: TOKEN_COLORS[2] ?? theme.success });
            }

            // Any remaining text in rest
            const consumed = attrPattern.lastIndex;
            if (consumed < rest.length) {
              const remaining = rest.slice(consumed);
              spans.push({ text: remaining, color: theme.text });
            }
          }
        } else {
          spans.push({ text: tag, color: theme.text });
        }
      }
    }

    lastIdx = pattern.lastIndex;
  }

  // Any remaining text after last tag
  if (lastIdx < code.length) {
    spans.push({ text: code.slice(lastIdx), color: theme.text });
  }

  return spans.length > 0 ? spans : [{ text: code, color: theme.accent }];
}

// ---------------------------------------------------------------------------
// Main Highlight Function
// ---------------------------------------------------------------------------

/**
 * Highlight code with syntax-appropriate colors.
 * Falls back to plain text (single color) for unsupported languages.
 */
export function highlightCode(code: string, language: string): HighlightSpan[] {
  // Handle empty code
  if (!code || code.length === 0) {
    return [];
  }

  const lang = language.toLowerCase().trim();

  try {
    // JavaScript/TypeScript family (sugar-high's primary support)
    if (jsLikeLanguages.has(lang)) {
      return highlightWithSugarHigh(code);
    }

    // Python (using sugar-high with Python preset)
    if (pythonLanguages.has(lang)) {
      return highlightWithSugarHigh(code, pythonPreset);
    }

    // CSS (using sugar-high with CSS preset)
    if (cssLanguages.has(lang)) {
      return highlightWithSugarHigh(code, cssPreset);
    }

    // Bash/Shell
    if (bashLanguages.has(lang)) {
      return highlightBash(code);
    }

    // JSON
    if (jsonLanguages.has(lang)) {
      return highlightJSON(code);
    }

    // YAML
    if (yamlLanguages.has(lang)) {
      return highlightYAML(code);
    }

    // HTML/XML
    if (htmlLanguages.has(lang)) {
      return highlightHTML(code);
    }

    // Unknown language - fall back to plain text with accent color
    return [{ text: code, color: theme.accent }];
  } catch {
    // Tokenization failed — fall back to plain text
    return [{ text: code, color: theme.accent }];
  }
}
