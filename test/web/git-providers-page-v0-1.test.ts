import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Git Providers page v0.1', () => {
  const pageSource = readRepoFile('web/src/pages/settings/GitProviders.tsx');
  const apiSource = readRepoFile('web/src/lib/api/git-providers.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');
  const backendRouteSource = readRepoFile('src/web/api/git-providers-routes.ts');
  const backendIndexSource = readRepoFile('src/web/api/routes.ts');

  it('replaces the PR3 stub with the spec-aligned Git Providers surface', () => {
    expect(pageSource).not.toContain('PR3 ships this page as a chrome stub');
    // The new page wires the aggregator endpoint instead of pointing the
    // user at the legacy stub copy. The connect / re-authorize flow still
    // hands off to /settings?tab=github because the device-flow UI lives
    // there; that handoff is intentional, not a stub.
    expect(pageSource).toContain('getGitHubProviderStatus');
  });

  it('renders the GitHub identity card with status pip + auth-method badge', () => {
    expect(pageSource).toContain('data-testid="github-pip"');
    expect(pageSource).toMatch(/pipKindFor\(/);
    expect(pageSource).toContain("t('gitProviders.github.cardTitle')");
    expect(pageSource).toMatch(/authMethodLabel\(/);
  });

  it('renders the four spec-required stat tiles', () => {
    expect(pageSource).toContain("t('gitProviders.github.stats.reposLinked')");
    expect(pageSource).toContain("t('gitProviders.github.stats.lastSync')");
    expect(pageSource).toContain("t('gitProviders.github.stats.connectedOn')");
    expect(pageSource).toContain("t('gitProviders.github.stats.scopes')");
    // Backend persists timestamps (PR #236), so the page must format
    // them through the shared helpers — relative time for the rolling
    // last-sync heartbeat, full datetime for the connected-on
    // milestone — and only fall back to "—" when the timestamp is
    // genuinely null (the brief window before the first sync).
    expect(pageSource).toMatch(/formatRelativeTime\(data\.lastSyncAt,\s*t\)/);
    expect(pageSource).toMatch(/formatDateTime\(data\.connectedAt\)/);
    // Corrupt-config defense: format helpers return '' for unparseable
    // input. The page must fall through to "—" rather than rendering
    // a blank tile (Codex CCG round 1 P3).
    expect(pageSource).toMatch(/lastSyncRelative \|\| '—'/);
    expect(pageSource).toMatch(/formatDateTime\(data\.connectedAt\) \|\| '—'/);
    expect(pageSource).toContain("t('gitProviders.github.pendingFirstSync')");
    // The old "available from v0.1.x" hint should be gone — the
    // capability is no longer deferred.
    expect(pageSource).not.toContain('timestampDeferred');
  });

  it('renders the absolute datetime as a tooltip on the relative lastSync tile', () => {
    // Audit / debugging often needs the exact moment, not just "3m ago".
    // The relative label sits inside a span whose title attribute
    // surfaces the full local datetime.
    expect(pageSource).toMatch(/<span title=\{lastSyncAbsolute \|\| undefined\}>/);
  });

  it('shows the pendingFirstSync hint only inside the connected card', () => {
    // The empty-state and loading/error cards must not surface the
    // "pending first sync" hint — it's specific to a configured-but-
    // unsynced provider, not a not-yet-connected one.
    const emptyCardMatch = /function GitHubEmptyCard\(\)[\s\S]*?return \(/.exec(pageSource);
    expect(emptyCardMatch).not.toBeNull();
    if (emptyCardMatch) {
      const start = emptyCardMatch.index + emptyCardMatch[0].length;
      const emptyCardBody = pageSource.slice(start, start + 1500);
      expect(emptyCardBody).not.toContain('pendingFirstSync');
    }
  });

  it('renders OAuth scope chips when scopes are reported, with PAT-aware fallback', () => {
    expect(pageSource).toContain('data-testid="github-scope-chip"');
    expect(pageSource).toMatch(/data\.scopes\.length > 0/);
    expect(pageSource).toContain("t('gitProviders.github.scopesUnavailableForPat')");
    expect(pageSource).toContain("t('gitProviders.github.scopesEmpty')");
  });

  it('exposes the spec action menu (Manage on GitHub + Re-authorize / Refresh / Disconnect)', () => {
    expect(pageSource).toContain("t('gitProviders.github.manageOnGithub')");
    expect(pageSource).toContain("t('gitProviders.github.reauthorize')");
    expect(pageSource).toContain("t('gitProviders.github.refreshRepoList')");
    expect(pageSource).toContain("t('gitProviders.github.disconnect')");
    // Disconnect requires a confirm prompt — destructive action. The
    // prompt is a styled <ConfirmDialog>, not the browser-native
    // window.confirm() — the dialog surfaces structured title +
    // description copy and the alert-shaped primitive must not creep
    // back in.
    expect(pageSource).toMatch(/<ConfirmDialog/);
    expect(pageSource).toContain("t('gitProviders.github.disconnectConfirm.title')");
    expect(pageSource).toContain("t('gitProviders.github.disconnectConfirm.description')");
    expect(pageSource).not.toMatch(/window\.confirm\(/);
  });

  it('renders the spec empty state with a single Connect GitHub CTA', () => {
    expect(pageSource).toContain('data-testid="github-empty-state"');
    expect(pageSource).toContain("t('gitProviders.github.empty.title')");
    expect(pageSource).toContain("t('gitProviders.github.empty.cta')");
  });

  it('renders compressed GitLab / Bitbucket rows as future placeholders', () => {
    expect(pageSource).toContain('data-testid="git-providers-other-list"');
    expect(pageSource).toContain('data-testid={`git-providers-other-${row.key}`}');
    expect(pageSource).toContain("t('gitProviders.others.gitlab')");
    expect(pageSource).toContain("t('gitProviders.others.bitbucket')");
    expect(pageSource).toContain("t('gitProviders.others.laterBadge')");
    expect(pageSource).toContain("t('gitProviders.others.comingLater')");
    expect(enSource).toContain("laterBadge: 'Later'");
    expect(koSource).toContain("laterBadge: 'Later'");
  });

  it('keeps tokenValid ternary state separate from connected (no fake green pip)', () => {
    // The pip MUST distinguish between "configured & valid", "configured but
    // rejected", and "configured but unreachable" (transient outage).
    expect(pageSource).toMatch(/if \(data\.tokenValid === true\) return 'connected'/);
    expect(pageSource).toMatch(/if \(data\.tokenValid === false\) return 'invalid'/);
    expect(pageSource).toMatch(/return 'unknown'/);
  });

  it('exports the typed API client targeting the backend aggregator', () => {
    expect(apiSource).toContain('export async function getGitHubProviderStatus');
    expect(apiSource).toContain("'/api/git-providers/github'");
    // tokenValid is explicitly tri-state; null must be valid.
    expect(apiSource).toMatch(/tokenValid:\s*boolean\s*\|\s*null/);
  });

  it('mounts the backend aggregator under /api/git-providers/github', () => {
    expect(backendRouteSource).toContain("'/git-providers/github'");
    expect(backendRouteSource).toContain('export function createGitProvidersRoutes');
    expect(backendIndexSource).toContain('createGitProvidersRoutes');
    expect(backendIndexSource).toMatch(/api\.route\('\/', createGitProvidersRoutes\(ctx\)\)/);
  });

  it('counts only GitHub-sourced active services as repos linked', () => {
    // Backend MUST filter by source='git', skip archived rows, and only
    // count repos that parse to a real github.com host (Codex CCG round 1
    // P2: the previous regex over-matched gist/api/raw subdomains).
    expect(backendRouteSource).toMatch(/svc\.source !== 'git'/);
    expect(backendRouteSource).toMatch(/svc\.archived_at/);
    expect(backendRouteSource).toMatch(/parseGitHubRepo/);
    expect(backendRouteSource).toMatch(/canonicalRepoKey/);
  });

  it('returns reposLinked=null when the DB read fails (no fabricated zero)', () => {
    // Codex CCG round 1 P2: silently coercing failures to 0 lies about
    // state during a transient outage. The route must propagate null.
    expect(backendRouteSource).toMatch(/reposLinked: number \| null/);
    expect(backendRouteSource).toMatch(/return null;\n {2}}/);
    expect(apiSource).toMatch(/reposLinked:\s*number\s*\|\s*null/);
    expect(pageSource).toMatch(/data\.reposLinked === null \? '—' : String\(data\.reposLinked\)/);
  });

  it('wires the tri-state tokenValid contract through the validation classifier', () => {
    // Codex CCG round 1 P1: GitHubProvider.validateToken() collapses
    // network errors into {valid:false}, so the route MUST classify the
    // error to keep transient outages out of the "invalid" pip.
    expect(backendRouteSource).toMatch(/classifyValidationError/);
    expect(backendRouteSource).toMatch(/'rejected' \? false : null/);
  });

  it('reload is race-safe — manual refresh / retry do not stale-overwrite', () => {
    // Codex CCG round 1 P2: the original `cancelled` flag only protected
    // the initial effect. The new useGitHubStatus tags every request and
    // ignores stale resolutions.
    expect(pageSource).toMatch(/requestIdRef = useRef\(0\)/);
    expect(pageSource).toMatch(/mountedRef = useRef\(true\)/);
    expect(pageSource).toMatch(/requestIdRef\.current !== requestId/);
  });

  it('persists connectedAt + lastSyncAt on successful GitHub validation', () => {
    expect(backendRouteSource).toContain('persistGitHubSuccessfulSync');
    expect(backendRouteSource).toMatch(
      /connectedAt:\s*ctx\.config\.gitProviders\.github\.connectedAt \?\? null/,
    );
    expect(backendRouteSource).toMatch(
      /lastSyncAt:\s*ctx\.config\.gitProviders\.github\.lastSyncAt \?\? null/,
    );
  });

  it('defines gitProviders.* keys in both languages', () => {
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/gitProviders:\s*\{/);
      expect(dict).toMatch(/github:\s*\{/);
      expect(dict).toMatch(/cardTitle:/);
      expect(dict).toMatch(/manageOnGithub:/);
      expect(dict).toMatch(/reauthorize:/);
      expect(dict).toMatch(/refreshRepoList:/);
      expect(dict).toMatch(/disconnect:/);
      expect(dict).toMatch(/disconnectConfirm:/);
      expect(dict).toMatch(/authMethod:\s*\{/);
      expect(dict).toMatch(/pip:\s*\{/);
      expect(dict).toMatch(/stats:\s*\{/);
      expect(dict).toMatch(/pendingFirstSync:/);
      expect(dict).toMatch(/empty:\s*\{/);
      expect(dict).toMatch(/others:\s*\{/);
      expect(dict).toMatch(/laterBadge:/);
      expect(dict).toMatch(/comingLater:/);
    }
  });
});
