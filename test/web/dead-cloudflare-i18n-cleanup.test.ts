import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Cloudflare-tied i18n keys stay pruned (v0.1)', () => {
  // PR #198 cut the Cloudflare auto-DNS frontend, and PR #244 retired
  // the legacy /settings tab page that hosted the only remaining
  // consumer of `settings.proxy.cloudflare.*` and the `tunnelGuide`
  // sibling. Together they orphaned a sizeable Cloudflare wiring
  // block in both locales:
  //
  //   - `settings.proxy.*` (entire block) — Traefik tab body, included
  //     `cloudflare:` and `tunnelGuide:` sub-blocks plus the `ports`,
  //     `warning`, and `loading` strings only TraefikSettingsTab read.
  //   - `domains.cloudflareNotConfigured` / `cloudflareGoToSettings` /
  //     `customDomainsHelp` / `notExposed` — four messages from the
  //     pre-cut Cloudflare auto-DNS UX that nobody renders any more.
  //
  // The single intentional Cloudflare reference that stays is
  // `projectDetail.domains.readOnlyHint` ("Cloudflare auto-DNS
  // returns in v0.2.") — that is the live v0.1 read-only message
  // shown on the Domains tab and is pinned by
  // `cloudflare-frontend-cut-v0-1.test.ts` independently.

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

    it(`keeps the live v0.1 Cloudflare-mention in projectDetail.domains.readOnlyHint (${locale}.ts)`, () => {
      // The Domains tab read-only hint intentionally tells users that
      // Cloudflare auto-DNS returns in v0.2. That copy must stay
      // intact — it is the only remaining Cloudflare reference and
      // its presence is also pinned by cloudflare-frontend-cut-v0-1.
      if (locale === 'en') {
        expect(dict).toMatch(/Cloudflare auto-DNS returns in v0\.2/);
      } else {
        expect(dict).toMatch(/Cloudflare 자동 DNS는 v0\.2에서 돌아옵니다/);
      }
    });
  }
});
