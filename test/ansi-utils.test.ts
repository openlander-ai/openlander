import { describe, expect, it } from 'vitest';
import { normalizeLogText, parseAnsiLine, stripAnsi } from '../web/src/lib/ansi';

describe('ansi utilities', () => {
  it('preserves colored output while keeping visible text intact', () => {
    const html = parseAnsiLine('build: \u001B[31mfailed\u001B[0m');

    expect(html).toContain('build: ');
    expect(html).toContain('failed');
    expect(html).toContain('<span');
    expect(html).not.toContain('\u001B');
  });

  it('extracts plain text from colored and OSC-formatted lines', () => {
    const line =
      'open \u001B]8;;https://openlander.ai\u0007dashboard\u001B]8;;\u0007 \u001B[32mready\u001B[0m';

    expect(stripAnsi(line)).toBe('open dashboard ready');
  });

  it('drops malformed ANSI fragments from plain-text search paths', () => {
    const malformed = 'warn: build failed\u001B[31';
    const brokenLink = ' see \u001B]8;;https://openlander.ai';

    expect(stripAnsi(malformed)).toBe('warn: build failed');
    expect(stripAnsi(`status${brokenLink}`)).toBe('status see ');
    expect(normalizeLogText(`${malformed}   `)).toBe('warn: build failed');
  });

  it('drops malformed wrappers without leaking broken escape fragments', () => {
    const brokenColor = '\u001B[32success';
    const brokenSingleEscape = 'prefix\u001B7suffix';
    const brokenCsi = 'start\u009B31';

    expect(stripAnsi(brokenColor)).toBe('uccess');
    expect(parseAnsiLine(`${brokenSingleEscape} plain`)).toContain('prefix7suffix plain');
    expect(stripAnsi(brokenCsi)).toBe('start');
  });

  it('normalizes backspaces and carriage returns for predictable search text', () => {
    const line = 'step 12\b3\r\u001B[33mdone\u001B[0m   ';

    expect(normalizeLogText(line)).toBe('done');
  });

  it('applies carriage-return overwrite semantics instead of merging stale progress text', () => {
    expect(normalizeLogText('progress 10%\rprogress 20%')).toBe('progress 20%');
    expect(stripAnsi('foobar\rhi')).toBe('hiobar');
  });

  it('drops unsupported control characters while preserving search-safe text', () => {
    const noisyLine = 'warn\u0000:\u0001 build\u007F\u009B31 failed\u001B]8;;https://openlander.ai';

    expect(stripAnsi(noisyLine)).toBe('warn: buildailed');
    expect(normalizeLogText(`${noisyLine}   `)).toBe('warn: buildailed');
  });
});
