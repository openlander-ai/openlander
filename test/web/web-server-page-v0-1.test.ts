import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Web Server page v0.1', () => {
  const pageSource = readRepoFile('web/src/pages/settings/WebServer.tsx');
  const apiSource = readRepoFile('web/src/lib/api/web-server.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('replaces the PR3 stub with the spec-aligned observability surface', () => {
    // Old stub copy is gone.
    expect(pageSource).not.toContain('PR3 ships this page as a chrome stub');
    expect(pageSource).not.toContain('/settings?tab=proxy');
    // New page wires four read-model API helpers.
    expect(pageSource).toContain('getWebServerSummary');
    expect(pageSource).toContain('getWebServerRoutes');
    expect(pageSource).toContain('getWebServerPorts');
    expect(pageSource).toContain('getWebServerExternalContainers');
  });

  it('renders the v0.1 health-summary stat strip cells', () => {
    expect(pageSource).toContain("t('webServer.strip.proxy')");
    expect(pageSource).toContain("t('webServer.strip.routes')");
    expect(pageSource).toContain("t('webServer.strip.entrypoints')");
    expect(pageSource).toContain("t('webServer.strip.allHealthy')");
    expect(pageSource).toContain("t('webServer.strip.issuesCount'");
    expect(pageSource).toContain("t('webServer.strip.lastReload'");
  });

  it('renders an issue banner only when routes report issues', () => {
    expect(pageSource).toContain('data-testid="web-server-issue-banner"');
    expect(pageSource).toMatch(/issueRows\.length > 0/);
    expect(pageSource).toContain("t('webServer.issues.title'");
  });

  it('renders containerized advertised-host configuration warnings', () => {
    expect(pageSource).toContain('data-testid="web-server-config-issue-banner"');
    expect(pageSource).toMatch(/configurationIssues\.length > 0/);
    expect(pageSource).toContain("t('webServer.configuration.title')");
    expect(apiSource).toContain('WebServerConfigurationIssue');
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/configuration:\s*\{/);
      expect(dict).toMatch(/advertised_host_missing:/);
      expect(dict).toContain('OPENLANDER_PUBLIC_HOST');
    }
  });

  it('localizes route issues by code with raw-message fallback', () => {
    expect(pageSource).toMatch(/function translateIssue\(/);
    expect(pageSource).toMatch(/`webServer\.issues\.codes\.\$\{issue\.code\}`/);
    // The banner uses translateIssue(...) instead of issue.message verbatim.
    expect(pageSource).toMatch(/translateIssue\(issue, t\)/);
    expect(pageSource).not.toMatch(/—\s*\{issue\.message\}/);
    // i18n exposes the five known codes the backend emits.
    for (const dict of [enSource, koSource]) {
      for (const code of [
        'service_not_running',
        'container_not_running',
        'missing_container_port',
        'domain_pending',
        'domain_error',
      ]) {
        expect(dict).toMatch(new RegExp(`${code}:`));
      }
    }
  });

  it('marks routes-table rows that carry issues with a testid + visual band', () => {
    expect(pageSource).toContain("data-testid={issue ? 'web-server-route-issue-row' : undefined}");
    // The visual marker (red bar) lives next to the host code.
    expect(pageSource).toMatch(/h-3 w-0\.5[\s\S]*?bg-\[color:var\(--ol-error\)\]/);
  });

  it('cuts the throughput / req-min surface — no fake metric leaks', () => {
    // v0.1 spec drops req/min until Traefik metrics scraping lands.
    expect(pageSource).not.toMatch(/req[\s/_-]*min/i);
    expect(pageSource).not.toMatch(/throughput/i);
  });

  it('makes Port allocation + External containers collapsible and closed by default', () => {
    expect(pageSource).toMatch(/const \[showPorts, setShowPorts\] = useState\(false\)/);
    expect(pageSource).toMatch(/const \[showExternal, setShowExternal\] = useState\(false\)/);
    // External card is disabled only after a successful fetch with zero
    // containers. Loading and error states keep the card interactive so
    // those messages stay reachable (Codex CCG round 1).
    expect(pageSource).toMatch(
      /disabled=\{!external\.loading && !external\.error && \(external\.data\?\.count \?\? 0\) === 0\}/,
    );
  });

  it('keeps the page read-only — footer note + no edit buttons', () => {
    expect(pageSource).toContain("t('webServer.footer')");
    expect(pageSource).not.toMatch(/onClick=.*edit/i);
    expect(pageSource).not.toMatch(/POST|PUT|DELETE/i);
  });

  it('does not invent a fake lastReloadAt — null hides the meta line entirely', () => {
    expect(pageSource).toMatch(/if \(!iso\) return '—'/);
    // The strip's lastReload meta line is only rendered when the backend
    // actually has a timestamp; CCG round 1 caught the regression where
    // null produced an awkward "Reloaded —" string.
    expect(pageSource).toMatch(/summary\.data\?\.lastReloadAt \? \(/);
  });

  it('localizes proxy.statusCode with a verbatim proxy.status fallback for stale backends', () => {
    // Backend PR #242 added `proxy.statusCode` + `proxy.statusSeverity`.
    // The frontend now i18n-maps `statusCode` and reads `statusSeverity`
    // for the Pip color when present. Older builds (or a frontend talking
    // to a stale backend mid-rolling-upgrade) still need to render
    // *something*, so the verbatim `proxy.status` fallback stays in place.
    //
    // Earlier (#213-era) the contract was the opposite — verbatim only,
    // no enum mapping. That was correct *before* the backend exposed
    // structured codes; this PR moves the contract forward now that
    // codes exist.
    expect(pageSource).toMatch(/t\(`webServer\.proxy\.statusCode\.\$\{code\}`/);
    expect(pageSource).toMatch(/proxy\.statusSeverity === 'error'/);
    expect(pageSource).toMatch(/proxy\.statusSeverity === 'warning'/);
    expect(pageSource).toMatch(/proxy\.statusSeverity === 'ok'/);
    // Verbatim fallback stays — render `{proxy.status}` when statusCode
    // is missing.
    expect(pageSource).toContain('{proxy.status}');
    // The legacy type/docker-provider derivation only runs in the
    // fallback branch.
    expect(pageSource).toMatch(/proxy\.type === 'none'/);
    expect(pageSource).toMatch(/proxy\.traefikDockerProvider === false/);
    // i18n exposes a row per backend code in both locales.
    for (const dict of [enSource, koSource]) {
      for (const code of [
        'docker_unavailable',
        'no_proxy_managed',
        'no_proxy_external',
        'traefik_managed',
        'traefik_external',
        'traefik_provider_disabled',
        'unsupported_proxy',
      ]) {
        expect(dict).toMatch(new RegExp(`${code}:`));
      }
    }
  });

  it('drops the fake "Container port" column from the ports table', () => {
    expect(pageSource).not.toMatch(/webServer\.ports\.col\.containerPort/);
    // The remaining columns are Service · Port · Environment.
    expect(pageSource).toContain("t('webServer.ports.col.service')");
    expect(pageSource).toContain("t('webServer.ports.col.hostPort')");
    expect(pageSource).toContain("t('webServer.ports.col.environment')");
  });

  it('renders an unknown / error state on the Routes stat cell when summary fails', () => {
    expect(pageSource).toContain("t('webServer.strip.unknown')");
    expect(pageSource).toMatch(/summary\.error \|\| !summary\.data/);
  });

  it('wraps the Routes and Ports tables in overflow-x-auto for narrow viewports', () => {
    const overflowMatches = pageSource.match(/<div className="overflow-x-auto">/g) ?? [];
    expect(overflowMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('exports the four typed API helpers from web/src/lib/api/web-server.ts', () => {
    for (const fn of [
      'getWebServerSummary',
      'getWebServerRoutes',
      'getWebServerPorts',
      'getWebServerExternalContainers',
    ]) {
      expect(apiSource).toContain(`export async function ${fn}`);
    }
    expect(apiSource).toContain("'/api/web-server/summary'");
    expect(apiSource).toContain("'/api/web-server/routes'");
    expect(apiSource).toContain("'/api/web-server/ports'");
    expect(apiSource).toContain("'/api/web-server/external-containers'");
  });

  it('defines webServer.* keys in both languages', () => {
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/webServer:\s*\{/);
      expect(dict).toMatch(/strip:\s*\{/);
      expect(dict).toMatch(/proxy:\s*\{/);
      expect(dict).toMatch(/routes:\s*\{/);
      expect(dict).toMatch(/ports:\s*\{/);
      expect(dict).toMatch(/external:\s*\{/);
      expect(dict).toMatch(/tls:\s*\{/);
      expect(dict).toMatch(/status:\s*\{/);
      expect(dict).toMatch(/relative:\s*\{/);
      // Subtitle phrasing must match the spec — read-only declared upfront.
      expect(dict).toMatch(/read-only|읽기 전용/);
    }
  });
});
