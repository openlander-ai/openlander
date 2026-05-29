import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// Sidebar brand chip — top-left "OpenLander vX.Y.Z" stamp.
// The pre-polish chip used 9.5px half-pixel font, an
// uppercase transform, and a 24px glyph that read as a status badge
// instead of a version stamp. This suite pins the polish so a future
// theme tweak can't regress the visual back to the badge form.
describe('Sidebar brand chip — version pin polish', () => {
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('renders the version pin at a stable integer font size (no 9.5px half-pixel)', () => {
    // Half-pixel sizes round inconsistently across browsers (9 in some,
    // 10 in others), making the pin look heavier on Firefox vs Chrome.
    expect(sidebarSource).not.toMatch(/text-\[9\.5px\]/);
    expect(sidebarSource).toMatch(/text-\[11px\][\s\S]*?APP_VERSION_LABEL/);
    expect(sidebarSource).toContain('APP_VERSION_LABEL');
    expect(enSource).toContain("versionAria: 'Version'");
    expect(koSource).toContain("versionAria: '버전'");
  });

  it('keeps the version label lowercase ("vX.Y.Z", not "VX.Y.Z")', () => {
    // The uppercase utility on a `vX.Y.Z` label produces "VX.Y.Z", which
    // breaks the canonical product version form. Drop the transform.
    const versionPinBlock = sidebarSource.match(/<span\b[^>]*APP_VERSION_LABEL[\s\S]*?<\/span>/);
    expect(versionPinBlock).not.toBeNull();
    expect(versionPinBlock![0]).not.toMatch(/uppercase/);
  });

  it('drops the rounded-full border pill so the pin reads as text, not a status badge', () => {
    const versionPinBlock = sidebarSource.match(/<span\b[^>]*APP_VERSION_LABEL[\s\S]*?<\/span>/);
    expect(versionPinBlock).not.toBeNull();
    expect(versionPinBlock![0]).not.toMatch(/rounded-full/);
    expect(versionPinBlock![0]).not.toMatch(/border-\[/);
  });

  it('uses a 28px brand mark chip (not 24px) for visual presence on the 56px topbar', () => {
    // Brand polish 2026-05-30: the `◆` glyph + soft-primary chip was
    // first replaced by the bare PNG mark (#217), then the chip frame
    // was restored as a follow-up because the floating mark read as
    // orphaned next to the "OpenLander vX.Y.Z" text. Pinning all three
    // pieces — chip frame, mark URL, mark size — keeps a future tweak
    // from regressing either the chip or the inner mark proportion.
    expect(sidebarSource).toMatch(
      /grid h-7 w-7 place-items-center rounded-md bg-\[color:var\(--ol-primary-soft\)\]/,
    );
    expect(sidebarSource).toMatch(/src=\{BRAND\.markUrl\}/);
    expect(sidebarSource).toMatch(/h-7 w-7 object-contain/);
  });

  it('uses 15px brand name (not 14px) so the name does not look undersized next to the glyph', () => {
    expect(sidebarSource).toMatch(/text-\[15px\] font-semibold tracking-tight/);
  });
});
