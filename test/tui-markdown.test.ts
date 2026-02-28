import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '../src/tui/markdown.js';

describe('parseMarkdown', () => {
  it('parses headings h1, h2, h3', () => {
    const tokens = parseMarkdown('# H1\n## H2\n### H3');

    expect(tokens).toEqual([
      { type: 'heading', level: 1, text: 'H1' },
      { type: 'heading', level: 2, text: 'H2' },
      { type: 'heading', level: 3, text: 'H3' },
    ]);
  });

  it('parses bold span inside paragraph', () => {
    const tokens = parseMarkdown('Hello **world**!');

    expect(tokens).toEqual([
      {
        type: 'paragraph',
        spans: [
          { type: 'text', text: 'Hello ' },
          { type: 'bold', text: 'world' },
          { type: 'text', text: '!' },
        ],
      },
    ]);
  });

  it('parses inline code span inside paragraph', () => {
    const tokens = parseMarkdown('Use `npm test` now');

    expect(tokens).toEqual([
      {
        type: 'paragraph',
        spans: [
          { type: 'text', text: 'Use ' },
          { type: 'code', text: 'npm test' },
          { type: 'text', text: ' now' },
        ],
      },
    ]);
  });

  it('parses fenced code block with language', () => {
    const tokens = parseMarkdown('```ts\nconst x = 1;\nconsole.log(x);\n```');

    expect(tokens).toEqual([
      {
        type: 'code_block',
        language: 'ts',
        code: 'const x = 1;\nconsole.log(x);',
      },
    ]);
  });

  it('parses unordered and ordered list items', () => {
    const tokens = parseMarkdown('- first\n* second\n1. one\n2. two');

    expect(tokens).toEqual([
      {
        type: 'list_item',
        ordered: false,
        index: 0,
        spans: [{ type: 'text', text: 'first' }],
      },
      {
        type: 'list_item',
        ordered: false,
        index: 0,
        spans: [{ type: 'text', text: 'second' }],
      },
      {
        type: 'list_item',
        ordered: true,
        index: 1,
        spans: [{ type: 'text', text: 'one' }],
      },
      {
        type: 'list_item',
        ordered: true,
        index: 2,
        spans: [{ type: 'text', text: 'two' }],
      },
    ]);
  });

  it('parses horizontal rules from --- and ***', () => {
    const tokens = parseMarkdown('---\n***');

    expect(tokens).toEqual([{ type: 'hr' }, { type: 'hr' }]);
  });

  it('parses link span inside paragraph', () => {
    const tokens = parseMarkdown('Visit [OpenLander](https://openlander.io) now');

    expect(tokens).toEqual([
      {
        type: 'paragraph',
        spans: [
          { type: 'text', text: 'Visit ' },
          { type: 'link', text: 'OpenLander', url: 'https://openlander.io' },
          { type: 'text', text: ' now' },
        ],
      },
    ]);
  });

  it('parses plain paragraph into single text span', () => {
    const tokens = parseMarkdown('plain text paragraph');

    expect(tokens).toEqual([
      {
        type: 'paragraph',
        spans: [{ type: 'text', text: 'plain text paragraph' }],
      },
    ]);
  });

  it('parses mixed inline styles in one paragraph', () => {
    const tokens = parseMarkdown('A **bold** and `code` with [link](https://x.dev).');

    expect(tokens).toEqual([
      {
        type: 'paragraph',
        spans: [
          { type: 'text', text: 'A ' },
          { type: 'bold', text: 'bold' },
          { type: 'text', text: ' and ' },
          { type: 'code', text: 'code' },
          { type: 'text', text: ' with ' },
          { type: 'link', text: 'link', url: 'https://x.dev' },
          { type: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('handles multiple blank lines between blocks and joins paragraph lines', () => {
    const input = '# Title\n\n\nline one\nline two\n\n\n- item';
    const tokens = parseMarkdown(input);

    expect(tokens).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      {
        type: 'paragraph',
        spans: [{ type: 'text', text: 'line one line two' }],
      },
      {
        type: 'list_item',
        ordered: false,
        index: 0,
        spans: [{ type: 'text', text: 'item' }],
      },
    ]);
  });
});
