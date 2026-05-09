import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// Deploy log surface — light-theme alignment + page-chrome dedup.
//
// Pre-fix the `.ol-log-pane` rule hard-coded the dark palette
// (`--log-bg: oklch(0.14 ...)`) regardless of the app theme, which
// broke the v0.1 design's "white log surface" requirement and produced
// a sandwich (light page chrome → dark log header → dark log body) on
// the default light theme. The page also stacked the same status /
// trigger / started / duration info three times: in the page meta row,
// in a 4-card grid below it, AND in the LogViewer's connection-state
// pill — the most redundant of the three (the grid) is now removed.
//
// A separate fix tightens `.ol-log-line` / `.ol-log-payload` so each
// virtualized row has a stable 22px height. The previous
// `pre-wrap` + `word-break: break-word` combo let long lines (stack
// traces, unbreakable URLs/hashes) grow to 2-N visual lines while the
// virtualizer's estimate stayed at 22px — the next row's
// `transform: translateY(...)` then landed on top of the wrapped
// content, producing the "text overlapping" bug operators reported.
describe('Deploy log surface — light-theme alignment + page-chrome dedup', () => {
  const cssSource = readRepoFile('web/src/components/Shell/LogViewer.css');
  const detailSource = readRepoFile('web/src/pages/DeploymentDetail.tsx');

  it('does not hard-code the dark log palette inside .ol-log-pane', () => {
    // Extract just the .ol-log-pane block (until the first closing
    // brace) so the dark-mode override below cannot fool the assertion.
    const paneBlock = cssSource.match(/\.ol-log-pane \{[\s\S]*?\n\}/);
    expect(paneBlock).not.toBeNull();
    expect(paneBlock![0]).not.toMatch(/--log-bg:\s*oklch\(0\.14/);
    expect(paneBlock![0]).not.toMatch(/--log-text:\s*oklch\(0\.92/);
  });

  it('inherits the app theme via tokens.css and adds an explicit dark-mode override', () => {
    // The default `.ol-log-pane` rule should drop the body color
    // overrides so they fall through to tokens.css's light defaults.
    // A separate `[data-theme='dark']` block re-applies the
    // hand-crafted dark chrome only when the app is in dark mode.
    expect(cssSource).toMatch(
      /\[data-theme='dark'\]\s*\.ol-log-pane[\s\S]*?--log-header-bg:/,
    );
    expect(cssSource).toMatch(/:root\.dark\s*\.ol-log-pane/);
    expect(cssSource).toMatch(/\.dark\s*\.ol-log-pane/);
  });

  it('keeps each log row at a stable 22px height (no pre-wrap → no virtualizer overlap)', () => {
    // Pin the regression: `pre-wrap` + `word-break: break-word`
    // on `.ol-log-payload` is what caused the row-height vs
    // estimate mismatch. Long lines now scroll horizontally inside
    // the row instead of wrapping vertically.
    expect(cssSource).toMatch(/\.ol-log-payload\s*\{[\s\S]*?white-space:\s*pre;[\s\S]*?overflow-x:\s*auto;/);
    expect(cssSource).not.toMatch(/\.ol-log-payload\s*\{[\s\S]*?white-space:\s*pre-wrap;/);
    expect(cssSource).not.toMatch(/\.ol-log-payload\s*\{[\s\S]*?word-break:\s*break-word;/);
  });

  it('aligns log row children to flex-start so wrapped baselines never push the row taller', () => {
    expect(cssSource).toMatch(/\.ol-log-line\s*\{[\s\S]*?align-items:\s*flex-start;/);
    expect(cssSource).not.toMatch(/\.ol-log-line\s*\{[\s\S]*?align-items:\s*baseline;/);
  });

  it('removes the redundant 4-card stat grid from DeploymentDetail (status/trigger/started/duration)', () => {
    // The same fields are already in the meta row above the grid +
    // the LogViewer pill. Pin the deletion so a future refactor can't
    // re-add the redundant grid silently.
    expect(detailSource).not.toMatch(/grid gap-3 sm:grid-cols-2 lg:grid-cols-4/);
    expect(detailSource).not.toMatch(/t\('deploy\.detail\.status'\)/);
    expect(detailSource).not.toMatch(/t\('deploy\.detail\.duration'\)/);
    expect(detailSource).not.toMatch(/t\('deploy\.detail\.trigger'\)/);
    expect(detailSource).not.toMatch(/t\('deploy\.detail\.started'\)/);
  });

  it('drops the redundant <h3>Build logs</h3> heading above the LogViewer', () => {
    expect(detailSource).not.toMatch(/t\('deploy\.detail\.buildLogs'\)/);
  });

  it('gives the LogViewer container a definite height so the virtualizer scroller never collapses', () => {
    expect(detailSource).toMatch(/h-\[640px\] min-h-\[400px\]/);
  });
});
