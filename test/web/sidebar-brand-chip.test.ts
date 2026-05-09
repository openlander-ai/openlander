import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// Sidebar brand chip — top-left "OpenLander v0.1" stamp
// (`docs/design/v0.1/source-notes/v0.1-decisions.md` §"Why move version
// to brand area"). The pre-polish chip used 9.5px half-pixel font, an
// uppercase transform, and a 24px glyph that read as a status badge
// instead of a version stamp. This suite pins the polish so a future
// theme tweak can't regress the visual back to the badge form.
describe('Sidebar brand chip — version pin polish', () => {
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');

  it('renders the version pin at a stable integer font size (no 9.5px half-pixel)', () => {
    // Half-pixel sizes round inconsistently across browsers (9 in some,
    // 10 in others), making the pin look heavier on Firefox vs Chrome.
    expect(sidebarSource).not.toMatch(/text-\[9\.5px\]/);
    expect(sidebarSource).toMatch(/text-\[11px\][\s\S]*?aria-label="Version v0\.1"/);
  });

  it('keeps the version label lowercase ("v0.1", not "V0.1")', () => {
    // The uppercase utility on a `v0.1` literal produces "V0.1", which
    // breaks the canonical product version form. Drop the transform.
    const versionPinBlock = sidebarSource.match(
      /aria-label="Version v0\.1"[\s\S]{0,200}/,
    );
    expect(versionPinBlock).not.toBeNull();
    expect(versionPinBlock![0]).not.toMatch(/uppercase/);
  });

  it('drops the rounded-full border pill so the pin reads as text, not a status badge', () => {
    const versionPinBlock = sidebarSource.match(
      /aria-label="Version v0\.1"[\s\S]{0,200}/,
    );
    expect(versionPinBlock).not.toBeNull();
    expect(versionPinBlock![0]).not.toMatch(/rounded-full/);
    expect(versionPinBlock![0]).not.toMatch(/border-\[/);
  });

  it('uses a 28px glyph (not 24px) for visual presence on the 56px topbar', () => {
    expect(sidebarSource).toMatch(/grid h-7 w-7 place-items-center rounded-md/);
  });

  it('uses 15px brand name (not 14px) so the name does not look undersized next to the glyph', () => {
    expect(sidebarSource).toMatch(/text-\[15px\] font-semibold tracking-tight/);
  });
});
