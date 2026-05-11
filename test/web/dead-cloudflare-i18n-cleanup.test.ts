import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Cloudflare-tied i18n keys stay pruned (v0.1)', () => {
  // PR #198 cut the Cloudflare auto-DNS frontend, PR #244 retired
  // the legacy /settings tab page that hosted the only remaining
  // consumer of `settings.proxy.cloudflare.*` and the `tunnelGuide`
  // sibling, and the v0.1 domain-routing CRUD UI (this PR) replaces
  // the previous read-only "Cloudflare auto-DNS returns in v0.2"
  // copy with the manual-DNS + external-proxy-TLS framing. Together
  // they orphaned a sizeable Cloudflare wiring block in both locales:
  //
  //   - `settings.proxy.*` (entire block) — Traefik tab body, included
  //     `cloudflare:` and `tunnelGuide:` sub-blocks plus the `ports`,
  //     `warning`, and `loading` strings only TraefikSettingsTab read.
  //   - `domains.cloudflareNotConfigured` / `cloudflareGoToSettings` /
  //     `customDomainsHelp` / `notExposed` — four messages from the
  //     pre-cut Cloudflare auto-DNS UX that nobody renders any more.
  //   - `domains.readOnlyHint` previously promised "Cloudflare auto-DNS
  //     returns in v0.2." That promise is retired; auto-DNS is fully
  //     cold-storage and the v0.1 plan does not bring it back.

  for (const locale of ['en', 'ko']) {
    const dict = readRepoFile(`web/src/i18n/${locale}.ts`);

    it(`drops the orphan settings.proxy.* leaf keys from ${locale}.ts`, () => {
      // The Traefik tab body lived at `settings.proxy.*`. There is
      // also a live `webServer.proxy.*` block (4-space indent) for
      // the v0.1 Web Server observability page, so we cannot anchor
      // on `^ {4}proxy:\s*\{` alone. Instead check leaf keys that
      // are 100% unique to the deleted Cloudflare wiring.
      expect(dict).not.toMatch(/tokenPermTunnel:/);
      expect(dict).not.toMatch(/tokenHelpLink:.*Cloudflare/);
      expect(dict).not.toMatch(/tunnelGuide:\s*\{/);
      // The four keys directly under `settings.proxy` (ports/warning/
      // loading/cloudflare nested) had no other consumer either —
      // grep audits should keep their leaf names off the file.
      expect(dict).not.toMatch(/^ {6}cloudflare:\s*\{/m);
    });

    it(`drops the four orphan Cloudflare keys from the domains block in ${locale}.ts`, () => {
      expect(dict).not.toMatch(/cloudflareNotConfigured:/);
      expect(dict).not.toMatch(/cloudflareGoToSettings:/);
      // `customDomainsHelp` and `notExposed` were the two pre-cut
      // Cloudflare-flavored hints. Their strings explicitly reference
      // Cloudflare Tunnel and have no consumer left.
      expect(dict).not.toMatch(/customDomainsHelp:/);
      expect(dict).not.toMatch(/^ {4}notExposed:/m);
    });

    it(`retires the "Cloudflare auto-DNS returns in v0.2" promise (${locale}.ts)`, () => {
      // The v0.1 CRUD plan deliberately keeps Cloudflare integration in
      // cold-storage. The old promise that auto-DNS "returns in v0.2"
      // must be gone from user-facing copy — TLS is handled by an
      // external proxy in v0.1, and ACME (not Cloudflare DNS provider
      // automation) is the v0.2 successor.
      if (locale === 'en') {
        expect(dict).not.toMatch(/Cloudflare auto-DNS returns in v0\.2/);
      } else {
        expect(dict).not.toMatch(/Cloudflare 자동 DNS는 v0\.2에서 돌아옵니다/);
      }
    });
  }
});
