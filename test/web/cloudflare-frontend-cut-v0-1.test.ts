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
  // v0.1 — the Cloudflare section can't survive a file that no longer
  // exists.

  it('renders Domains tab read-only with manual DNS hint', () => {
    // No Add/Detach buttons in v0.1
    expect(serviceDetailSource).not.toMatch(/Add domain/);
    expect(serviceDetailSource).not.toMatch(/setGuideKind\('add-domain'\)/);
    expect(serviceDetailSource).not.toMatch(/setGuideKind\('remove-domain'\)/);
    // Hint copy points users to manual DNS through translated copy.
    expect(serviceDetailSource).toContain("t('projectDetail.domains.readOnlyHint')");
    expect(enSource).toMatch(/Read-only in v0\.1/);
    expect(enSource).toMatch(/point an A or CNAME record/i);
    expect(koSource).toContain('v0.1에서는 읽기 전용입니다');
  });
});
