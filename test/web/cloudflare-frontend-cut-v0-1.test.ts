import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Cloudflare frontend cut for v0.1', () => {
  const systemSource = readRepoFile('web/src/lib/api/system.ts');
  const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('drops Cloudflare API client functions from system.ts', () => {
    expect(systemSource).not.toMatch(/export async function configureCloudflare/);
    expect(systemSource).not.toMatch(/export async function connectCloudflare/);
    expect(systemSource).not.toMatch(/export async function getCloudflareStatus/);
    // No live API call to the cloudflare backend route. Comments mentioning
    // the dormant path are allowed.
    expect(systemSource).not.toMatch(/(?:fetch|apiGet|apiPost|apiPostVoid|apiDelete)\(['"`]\/api\/setup\/cloudflare/);
  });

  // The legacy "removes the Cloudflare Tunnel section from
  // TraefikSettingsTab" check is subsumed by
  // dead-settings-routes-cleanup.test.ts, which pins that the entire
  // TraefikSettingsTab.tsx (and its host SettingsPage.tsx) are gone in
  // v0.1.

  it('renders Domains tab with manual-DNS CRUD (v0.1)', () => {
    // v0.1 ships the manual-DNS + service-scoped CRUD UI. The previous
    // "read-only + Cloudflare auto-DNS in v0.2" framing is retired —
    // domain mapping is now a first-class managed-Traefik feature and
    // Cloudflare auto-DNS is fully cold-storage per the locked v0.1
    // domain-routing plan.

    // The tab now has Add/Delete entry points sourced from the new client.
    expect(serviceDetailSource).toMatch(/projectDetail\.domains\.add/);
    expect(serviceDetailSource).toMatch(/createServiceDomain/);
    expect(serviceDetailSource).toMatch(/deleteServiceDomain/);
    // No stale read-only hint reference.
    expect(serviceDetailSource).not.toMatch(/t\('projectDetail\.domains\.readOnlyHint'\)/);

    // The locked v0.1 copy frames TLS as external-proxy and rejects
    // any "Cloudflare auto-DNS returns" promise (cold-storage).
    expect(enSource).toMatch(/external proxy in v0\.1/i);
    expect(koSource).toMatch(/외부 프록시/);
    expect(enSource).not.toMatch(/Cloudflare auto-DNS returns in v0\.2/);
    expect(koSource).not.toMatch(/Cloudflare 자동 DNS는 v0\.2에서 돌아옵니다/);
  });
});
