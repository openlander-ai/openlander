import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// PR #256 added `description` + `tags` to the project list response so
// they survive a list refresh; the frontend never wired them into the
// IA surfaces the design (docs/design/v1.0/GUIDE-02-page-skeleton.md) calls for, so users could save
// values via Settings but never see them outside the editor. This
// suite pins the rendering surfaces so a regression can't silently
// reopen the gap.
describe('Project metadata display (description + tags surface to IA)', () => {
  const gridSource = readRepoFile('web/src/pages/ProjectsGrid.tsx');
  const viewSource = readRepoFile('web/src/pages/ProjectView.tsx');

  it('renders description as a 1-line subtitle on each project card', () => {
    // Per docs/design/v1.0/GUIDE-02-page-skeleton.md §"Card grid": each card has a 1-line subtitle. We
    // pin the truncated paragraph + the conditional guard so a future
    // refactor can't drop the description silently.
    expect(gridSource).toMatch(
      /\{p\.description &&[\s\S]*?<p[^>]*?\btruncate\b[\s\S]*?\{p\.description\}/,
    );
  });

  it('renders tags as a chip row above the stats strip', () => {
    // Per docs/design/v1.0/GUIDE-02-page-skeleton.md §"Card grid": "optional status pills". Tags are
    // shown as small rounded chips; we cap the visible count at 6
    // and surface the overflow as `+N`.
    expect(gridSource).toMatch(/p\.tags && p\.tags\.length > 0/);
    expect(gridSource).toMatch(/p\.tags\.slice\(0, 6\)\.map/);
    expect(gridSource).toMatch(/\+\{p\.tags\.length - 6\}/);
  });

  it('caps individual tag width so a single long tag cannot overflow the row (Codex round 1 P2)', () => {
    // Codex round-1 P2: tags are user-controlled and only trimmed/
    // deduped server-side, so a long unbroken tag could blow out the
    // card. We pin both the max-width clamp + truncate behaviour and
    // the hover tooltip that exposes the full string.
    expect(gridSource).toMatch(/max-w-\[14rem\][\s\S]*?truncate/);
    expect(gridSource).toMatch(/title=\{tag\}/);
  });

  it('uses description as the ProjectView header subtitle when present', () => {
    // Per docs/design/v1.0/GUIDE-02-page-skeleton.md §"Page header": "Subtitle / description (muted,
    // 14px)". Description wins over the slug fallback so the v0.1
    // header reflects the user's metadata.
    expect(viewSource).toMatch(/realProject\?\.description\?\.trim\(\)/);
  });

  it('keeps the slug visible alongside the description (Gemini round 1 P2)', () => {
    // Gemini round-1 P2: hiding the slug behind a description costs
    // ops users their CLI / compose-path identity check. Round-2
    // restores the slug as a muted suffix when displayName diverges
    // from the slug, but the description-as-subtitle remains the
    // primary copy.
    expect(viewSource).toMatch(/showSlug/);
    expect(viewSource).toMatch(/· \{realProject!\.name\}/);
  });

  it('clamps long descriptions in the ProjectView header (Codex round 1 P2)', () => {
    // Codex round-1 P2: an unbounded description could dominate the
    // header. We render the subtitle inside a span with line-clamp-2
    // + break-words so a pasted paragraph stays on two lines.
    expect(viewSource).toMatch(/line-clamp-2 break-words/);
  });
});
