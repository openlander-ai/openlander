import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// Deploy log row prefix overflow.
//
// Pre-fix `.ol-log-prefix` was hard-clamped to `width: 7ch` with no
// `overflow` guard. The canonical 4 prefixes (`info` / `success` /
// `warning` / `error`) all fit, but the SSE backend now emits the
// build's `scope` string verbatim — `dockerfile` (10 chars),
// `image_pull` (10), `container_create` (16). Long prefixes spilled
// across the 12px `gap` and overlapped the payload, which is what
// users described as "build log glyphs are stacking on top of each
// other" after PR #268's earlier dedup pass landed.
//
// Fix: switch to `min-width: 7ch / max-width: 14ch` with `overflow:
// hidden` + `text-overflow: ellipsis` so short prefixes still align
// while long ones clip cleanly. JSX adds `title={entry.prefix}` so
// the full string stays recoverable on hover.
describe('Deploy log row — prefix column overflow guard', () => {
  const cssSource = readRepoFile('web/src/components/Shell/LogViewer.css');
  const tsxSource = readRepoFile('web/src/components/Shell/LogViewer.tsx');

  // Extract the .ol-log-prefix block (until its first closing brace)
  // so the assertions don't false-match the colored variants below it.
  const prefixBlock = cssSource.match(/\.ol-log-prefix\s*\{[\s\S]*?\n\}/);

  it('locates the .ol-log-prefix CSS rule', () => {
    expect(prefixBlock).not.toBeNull();
  });

  it('does not hard-clamp the prefix column to a fixed width', () => {
    expect(prefixBlock![0]).not.toMatch(/^\s*width:\s*7ch;/m);
  });

  it('lets short prefixes align (min-width: 7ch) but caps long ones (max-width: 14ch)', () => {
    expect(prefixBlock![0]).toMatch(/min-width:\s*7ch;/);
    expect(prefixBlock![0]).toMatch(/max-width:\s*14ch;/);
  });

  it('clips the prefix with ellipsis instead of letting it overflow into the payload', () => {
    expect(prefixBlock![0]).toMatch(/overflow:\s*hidden;/);
    expect(prefixBlock![0]).toMatch(/text-overflow:\s*ellipsis;/);
    expect(prefixBlock![0]).toMatch(/white-space:\s*nowrap;/);
  });

  it('exposes the full prefix string via a title tooltip on the JSX side', () => {
    // Without this, a clipped `container_create` would render as
    // `CONTAINER_CR…` with no way to recover the trailing letters.
    expect(tsxSource).toMatch(
      /<span\s+className=\{cn\('ol-log-prefix',\s*entry\.prefix\)\}\s+title=\{entry\.prefix\}>/,
    );
  });
});
