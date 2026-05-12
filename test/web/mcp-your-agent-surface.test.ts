import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Your Agent (MCP) v0.1 surface', () => {
  const source = readRepoFile('web/src/pages/MCPServer.tsx');
  const snippetSource = readRepoFile('web/src/lib/mcp-config-snippets.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('renders three top-level cards (Your Agent, Setup, Recent)', () => {
    expect(source).toContain("t('mcpServer.title')");
    expect(source).toContain("t('mcpServer.subtitle')");
    expect(source).toContain("t('mcpServer.setup.title')");
    expect(source).toContain("t('mcpServer.setup.subtitle')");
    expect(source).toContain("t('mcpServer.recent.title')");
  });

  it('uses the single-token model — no per-token list, no per-session disconnect UI', () => {
    // The v0.1 spec calls for one token surface, not a list/issue/revoke
    // table. The previous shape had multiple PAT rows; pin that it stays
    // gone.
    expect(source).not.toMatch(/<table[\s\S]*?token/i);
    // Disconnect-per-session was on the prior MCPServer page; v0.1
    // spec drops it (regenerate-token replaces it).
    expect(source).not.toMatch(/handleDisconnect/);
    expect(source).not.toMatch(/disconnectMcp/);
    // The Generate button only appears when there is no active token.
    expect(source).toContain("t('mcpServer.tokens.generateAction')");
    expect(source).toContain("t('mcpServer.tokens.regenerateAction')");
  });

  it('only reveals plaintext for the just-issued token', () => {
    // PR #235 endpoints return plaintext only on actual mint/rotate
    // (`created: true`); reuse returns metadata with plaintext=null.
    // The page must guard on the plaintext field, not assume it.
    expect(source).toMatch(/if \(issued\.plaintext\)/);
    expect(source).toMatch(/setNewTokenPlain\(issued\.plaintext\)/);
    expect(source).toMatch(/setRevealed\(true\)/);
    // Once revealed=false (or after refresh) we display only the
    // suffix, never the plaintext from a prior session.
    expect(source).toMatch(/`mcp_…\$\{tokenSuffix\}`/);
  });

  it('regenerate is a single atomic call to /api/mcp/token/regenerate', () => {
    // PR #235 owns the revoke-then-issue invariant on the server side
    // under withOrgMcpPatTokenLock. The page must NOT re-implement the
    // list/revoke loop client-side any more — that resurrects the
    // multi-tab race the backend lock was designed to close.
    expect(source).toMatch(/await regenerateOrgMcpToken\(/);
    expect(source).not.toMatch(/revokeMcpPatToken/);
    expect(source).not.toMatch(/for \(const tok of toRevoke\)/);
    // Confirmation is a styled <ConfirmDialog>, not the browser-native
    // window.confirm() — the prompt must surface the structured
    // title/description copy, and the alert-shaped primitive must not
    // creep back in.
    expect(source).toMatch(/<ConfirmDialog/);
    expect(source).toContain("t('mcpServer.tokens.regenerateConfirm.title')");
    expect(source).toContain("t('mcpServer.tokens.regenerateConfirm.description')");
    expect(source).not.toMatch(/window\.confirm\(/);
  });

  it('renders multi-client config tabs with placeholder when token is not revealed', () => {
    // The Setup card no longer hardcodes a single Claude Desktop snippet;
    // it walks the shared snippet module (web/src/lib/mcp-config-snippets.ts)
    // for one tab per supported MCP client. Both the page and the setup
    // wizard read the same source so they cannot drift.
    expect(source).toMatch(/buildAllClientConfigs\(/);
    expect(source).toMatch(/<TabsTrigger /);
    expect(source).toMatch(/<TabsContent /);
    expect(snippetSource).toContain('mcpServers');
    // Hide must redact the snippet too — embed the plaintext only
    // when the token row is currently revealed.
    expect(source).toContain("'<your-token>'");
    expect(source).toMatch(/revealed && newTokenPlain \? newTokenPlain : ['"]<your-token>['"]/);
    // The shared module is the only place that owns per-client config
    // shape — keep that contract pinned.
    expect(snippetSource).toMatch(/buildClaudeCodeCmd/);
    expect(snippetSource).toMatch(/buildClaudeDesktopConfig/);
    expect(snippetSource).toMatch(/buildCursorConfig/);
    expect(snippetSource).toMatch(/buildWindsurfConfig/);
    expect(snippetSource).toMatch(/buildVscodeConfig/);
  });

  it('warns the user when the backend rotates a legacy ol_ token under their feet', () => {
    // ensureOrgMcpPatToken / rotateOrgMcpPatToken can revoke a legacy
    // `ol_` API token row as part of the single-token cleanup. The UI
    // must surface this — a still-running MCP client on the legacy
    // credential will silently start failing otherwise (Codex CCG
    // round 1 P2).
    expect(source).toMatch(/issued\.legacyTokenRotated/);
    expect(source).toContain("t('mcpServer.tokens.legacyTokenRotated')");
    // The notice is distinct from the normal regenerate success.
    expect(source).toMatch(/toast\.warning\(t\('mcpServer\.tokens\.legacyTokenRotated'\)\)/);
  });

  it('reads the active token from /api/mcp/token, not by client-side filter', () => {
    // PR #235 moves "is this row a usable PAT?" off the client.
    // The page must call getOrgMcpToken() and trust the server-side
    // filter rather than reimplementing the legacy-default / expired
    // / revoked rules.
    expect(source).toMatch(/await getOrgMcpToken\(\)/);
    expect(source).not.toMatch(/listMcpPatTokens/);
    // The hand-rolled client-side filters that lived alongside the
    // old listMcpPatTokens path are gone too.
    expect(source).not.toMatch(/tok\.tokenType === ['"]pat['"]/);
    expect(source).not.toMatch(/Date\.parse\(tok\.expiresAt\) > now/);
  });

  it('Recent agent calls deep-links to the unfiltered Activity page', () => {
    // The recent panel filters server-side by actor=mcp, but the
    // /activity page URL-controls a kind filter (type=mcp), not an
    // actor filter. Linking with ?type=mcp would show a narrower set
    // (MCP session-state events) than the recent panel above. Bare
    // /activity keeps the "Full timeline →" promise honest.
    expect(source).toMatch(/navigate\(['"]\/activity['"]\)/);
    expect(source).not.toMatch(/navigate\(['"]\/activity\?type=mcp['"]\)/);
  });

  it('defines mcpServer.* keys in both en and ko', () => {
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/mcpServer:\s*\{/);
      expect(dict).toMatch(/title: ['"]Your Agent['"]/);
      expect(dict).toMatch(/regenerateAction:/);
      expect(dict).toMatch(/legacyTokenRotated:/);
      expect(dict).toMatch(/passwordHint:/);
      expect(dict).toMatch(/revealedHint:/);
      expect(dict).toMatch(/restartHint:/);
      expect(dict).toMatch(/relative:\s*\{/);
    }
  });
});

// `Settings → MCP duplicate retired (v0.1)` previously asserted that
// `SettingsPage.tsx` no longer mounted McpSettingsTab. The whole
// `SettingsPage.tsx` host has since been deleted in the dead-settings
// cleanup, so that contract is now pinned at a stronger layer by
// `dead-settings-routes-cleanup.test.ts`.

describe('Korean polish (Gemini CCG)', () => {
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('flips issuedAt so {when} comes first ("5분 전 발급" not "발급 5분 전")', () => {
    expect(koSource).toMatch(/issuedAt:\s*['"]\{when\} 발급['"]/);
    expect(koSource).not.toMatch(/issuedAt:\s*['"]발급 \{when\}['"]/);
  });
});
