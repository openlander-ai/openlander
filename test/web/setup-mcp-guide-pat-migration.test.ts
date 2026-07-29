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
    expect(source).toMatch(/} else \{[\s\S]*?setExistingSuffix\(issued\.token\.suffix\)/);
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

  it('uses the editable instance name for generated snippets', () => {
    expect(source).toContain('useMcpInstance()');
    expect(source).toContain('serverName: mcpInstance.serverName');
    expect(source).toContain("t('setup.mcp.instanceName')");
    expect(source).toContain("t('setup.mcp.tryPrompt', { name: mcpInstance.serverName })");
    expect(source).toContain("t('setup.mcp.tryAfterConnect')");
  });

  it('offers Codex in the shared onboarding config list', () => {
    const snippetSource = readRepoFile('web/src/lib/mcp-config-snippets.ts');

    expect(snippetSource).toContain("id: 'codex'");
    expect(snippetSource).toContain("filename: '~/.codex/config.toml'");
    expect(enSource).toMatch(/subtitle: ['"]Let Codex, Claude Code, Cursor/);
    expect(koSource).toMatch(/subtitle: ['"]Codex, Claude Code, Cursor/);
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
      expect(dict).toMatch(/instanceName:/);
      expect(dict).toMatch(/instanceDefaultWarning:/);
      expect(dict).toMatch(/tryAfterConnect:/);
      expect(dict).toMatch(/tryPrompt:/);
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

  // Onboarding R3 (2026-05-13): the wizard no longer auto-issues a
  // token on mount. Skip-for-now must mean "don't enrol me yet". The
  // mount-time probe is a metadata GET; issuance lives behind an
  // explicit Generate CTA.
  describe('R3 — explicit issuance', () => {
    it('mount probe uses getOrgMcpToken (metadata) instead of ensure', () => {
      // The first `await` after mount must be the GET, not the POST.
      // ensureOrgMcpToken still appears elsewhere — inside handleGenerate —
      // so we anchor the assertion to the mount useEffect body by its
      // dependency array `[t]`, ensuring the auto-issue pattern isn't
      // hiding inside the mount path.
      expect(source).toMatch(
        /useEffect\(\(\) => \{[\s\S]*?await getOrgMcpToken\(\)[\s\S]*?\}, \[t\]\)/,
      );
      // The handleGenerate path is the only place the POST may live.
      // ensureOrgMcpToken must NOT appear inside any line whose
      // enclosing block is the mount useEffect — by far the easiest
      // check is "between `setIsFetching(true)` (mount probe init) and
      // the closing `}, [t])` we never see ensureOrgMcpToken".
      const mountBlockMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[t\]\)/);
      expect(mountBlockMatch?.[0]).toBeDefined();
      expect(mountBlockMatch?.[0]).not.toContain('ensureOrgMcpToken');
    });

    it('exposes a Generate CTA when no token is in play', () => {
      expect(source).toContain('data-testid="setup-mcp-generate-cta"');
      expect(source).toMatch(/handleGenerate/);
      expect(source).toContain("t('setup.mcp.generateToken')");
      expect(source).toContain("t('setup.mcp.noTokenYet')");
    });

    it('gates the snippet surface on plaintext only — not the existing-token suffix', () => {
      // CCG (Codex + Gemini, R3): existingSuffix has no plaintext, so
      // surfacing the copy/manual block in that case would leave the
      // user copying `olp_YOUR_TOKEN` placeholder while a banner says
      // "regenerate at Your Agent". Surface is now plaintext-gated;
      // the banner alone owns the returning-user explanation.
      expect(source).toMatch(/showSnippetSurface = token !== null;/);
      expect(source).not.toMatch(
        /showSnippetSurface = token !== null \|\| existingSuffix !== null/,
      );
      expect(source).toMatch(/\{showSnippetSurface && \(/);
    });

    it('keeps the explicit ensure call inside handleGenerate (post-CTA)', () => {
      expect(source).toMatch(/handleGenerate[\s\S]*?await ensureOrgMcpToken/);
    });

    it('defines generateToken / generating / noTokenYet in both languages', () => {
      for (const dict of [enSource, koSource]) {
        expect(dict).toMatch(/generateToken:/);
        expect(dict).toMatch(/generating:/);
        expect(dict).toMatch(/noTokenYet:/);
      }
    });
  });
});
