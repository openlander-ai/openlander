import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('McpGuideStep — PAT migration (v0.1)', () => {
  const source = readRepoFile('web/src/components/setup/McpGuideStep.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('drops the legacy ol_ token path (getApiToken) and uses the v0.1 ensure endpoint', () => {
    // The import + invocation must be gone — a residual reference in
    // the migration docstring is fine.
    expect(source).not.toMatch(/^import \{[^}]*getApiToken/m);
    expect(source).not.toMatch(/getApiToken\(\)/);
    // The wizard now uses POST /api/mcp/token (PR #235) — the
    // earlier list-then-conditional-issue composition is replaced by
    // a single idempotent ensure call.
    expect(source).toContain('ensureOrgMcpToken');
    expect(source).not.toContain('listMcpPatTokens');
    expect(source).not.toContain('issueMcpPatToken');
  });

  it('uses POST /api/mcp/token to mint or reuse the org token in one call', () => {
    expect(source).toMatch(
      /await ensureOrgMcpToken\(\{\s*name: t\(['"]setup\.mcp\.tokenName['"]\)/,
    );
  });

  it('renders the wizard token only when the backend echoes plaintext', () => {
    // ensure() returns plaintext only on actual mint (created=true);
    // on reuse it returns metadata with plaintext=null. The wizard
    // must guard on plaintext, surface the suffix on reuse, and
    // never pretend a placeholder is a copyable token.
    expect(source).toMatch(/if \(issued\.plaintext\) \{[\s\S]*?setToken\(issued\.plaintext\)/);
    expect(source).toMatch(
      /} else \{[\s\S]*?setExistingSuffix\(issued\.token\.suffix\)/,
    );
  });

  it('updates the snippet placeholder from ol_ to olp_', () => {
    // Old default `'ol_YOUR_TOKEN'` would have left the wizard producing
    // configs with the legacy prefix. PAT tokens are `olp_*`.
    expect(source).toContain("const TOKEN_PLACEHOLDER = 'olp_YOUR_TOKEN'");
    expect(source).not.toContain("'ol_YOUR_TOKEN'");
  });

  it('renders an existing-token warning + an issue-failure fallback', () => {
    expect(source).toContain('data-testid="setup-mcp-existing-token"');
    expect(source).toContain('data-testid="setup-mcp-token-error"');
    expect(source).toContain("t('setup.mcp.tokenAlreadyIssued', { suffix: existingSuffix })");
  });

  it('surfaces the legacy ol_ rotation banner when the backend retired one during setup', () => {
    // ensureOrgMcpPatToken can revoke a legacy `ol_` API token row
    // as part of the single-token cleanup. The wizard must show the
    // user this happened — a still-running MCP client on the legacy
    // credential will silently start failing otherwise (Codex CCG
    // round 1 P2).
    expect(source).toMatch(/issued\.legacyTokenRotated/);
    expect(source).toMatch(/setLegacyRotated\(true\)/);
    expect(source).toContain('data-testid="setup-mcp-legacy-rotated"');
    expect(source).toContain("t('setup.mcp.legacyTokenRotated')");
  });

  it('keeps the quick-copy block free of inline status text', () => {
    // Codex CCG round 1 flagged that the prior shape embedded
    // `olp_…<suffix> (already issued)` or `<error>` directly into the
    // copyable block. Now the block uses `tokenForSnippet` (real token
    // when issued, `olp_YOUR_TOKEN` placeholder otherwise) and the
    // existing-token / error states surface only via dedicated panels.
    expect(source).toMatch(/Token: \$\{tokenForSnippet\}/);
    expect(source).not.toContain('(already issued)');
    expect(source).not.toContain('<error>');
  });

  it('defines tokenName / tokenAlreadyIssued / tokenError in both languages', () => {
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/tokenName:/);
      expect(dict).toMatch(/tokenAlreadyIssued:/);
      expect(dict).toMatch(/tokenError:/);
      expect(dict).toMatch(/legacyTokenRotated:/);
      // {suffix} placeholder must survive in both languages.
      expect(dict).toMatch(/olp_…\{suffix\}/);
    }
  });

  it('Korean copy uses 무효화 (technical) and 사용할 (formal) per Gemini polish', () => {
    expect(koSource).toMatch(/기존 토큰은 무효화됩니다/);
    expect(koSource).toMatch(/설정 코드에 사용할 새 토큰/);
    // The earlier "붙여 쓸" + "폐기" pair must not creep back.
    expect(koSource).not.toMatch(/여기에 붙여 쓸 새 값/);
    expect(koSource).not.toMatch(/기존 토큰은 폐기됩니다/);
  });
});
