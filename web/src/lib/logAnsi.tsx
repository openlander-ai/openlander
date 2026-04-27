/**
 * ANSI escape parser + LogPayload renderer.
 *
 * Extracted from LogViewer.tsx in PR4-C so the main file can stay under
 * ~400 lines and the regex with the literal U+001B (ESC) character lives
 * in a focused module.
 *
 * The regex matches both:
 *   - Real ANSI from the backend: `<ESC>[31m...<ESC>[0m`
 *   - Literal bracketed form used in test fixtures: `[31m...[0m`
 *
 * The leading ESC is therefore optional. The eslint-disable on the regex
 * line is intentional - we WANT to match the U+001B character.
 */
import type { ReactNode } from 'react';
import type { LogEntry } from './logScripts';

export interface AnsiPart {
  text: string;
  cls: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /?\[([0-9;]*)m/g;

function parseAnsi(s: string): AnsiPart[] {
  if (!s.includes('[')) return [{ text: s, cls: '' }];
  const out: AnsiPart[] = [];
  ANSI_RE.lastIndex = 0;
  let last = 0;
  let cls = '';
  let m: RegExpExecArray | null;
  while ((m = ANSI_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), cls });
    const codes = m[1].split(';').filter(Boolean);
    for (const c of codes) {
      if (c === '0' || c === '') cls = '';
      else if (c === '1') cls = `ansi-bold ${cls}`.trim();
      else if (c === '2') cls = `ansi-dim ${cls}`.trim();
      else if (c === '31') cls = 'ansi-red';
      else if (c === '32') cls = 'ansi-green';
      else if (c === '33') cls = 'ansi-yellow';
      else if (c === '35') cls = 'ansi-magenta';
      else if (c === '36') cls = 'ansi-cyan';
    }
    last = ANSI_RE.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last), cls });
  return out;
}

/**
 * Render a single LogEntry payload. Handles three shapes:
 *   - `{progress}` placeholder with numeric meta -> animated bar
 *   - `{step}#N ...` step header marker -> mono-pill prefix + remainder
 *   - Plain text -> ANSI-colored spans
 */
export function LogPayload({ entry, progress }: { entry: LogEntry; progress?: number }): ReactNode {
  if (entry.payload === '{progress}' && entry.progress) {
    const total = entry.progress.total;
    const done = progress ?? 1;
    const cur = (total * Math.min(done, 1)).toFixed(2);
    return (
      <span>
        <span style={{ color: 'oklch(0.72 0.012 255)' }}>{entry.progress.name} </span>
        <span className="ol-progress-inline">
          <span className="ol-progress-inline-bar">
            <span style={{ width: `${Math.min(done, 1) * 100}%` }} />
          </span>
          <span style={{ color: 'oklch(0.72 0.012 255)' }}>
            {cur}MB / {total}MB
          </span>
        </span>
      </span>
    );
  }
  let text = entry.payload;
  let stepMarker: string | null = null;
  const stepMatch = text.match(/^\{step\}(#\d+)\s*/);
  if (stepMatch) {
    stepMarker = stepMatch[1];
    text = text.slice(stepMatch[0].length);
  }
  const parts = parseAnsi(text);
  return (
    <span>
      {stepMarker && <span className="ol-step-marker">{stepMarker}</span>}
      {parts.map((p, i) => (
        <span key={i} className={p.cls}>
          {p.text}
        </span>
      ))}
    </span>
  );
}
