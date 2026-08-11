import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('custom domain ownership UI', () => {
  const detail = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
  const en = readRepoFile('web/src/i18n/en.ts');
  const ko = readRepoFile('web/src/i18n/ko.ts');

  it('distinguishes custom domains from managed public sharing in both locales', () => {
    expect(en).toContain("add: 'Add custom domain'");
    expect(en).toContain("title: 'Remove custom domain'");
    expect(ko).toContain("add: '직접 연결 도메인 추가'");
    expect(ko).toContain("title: '직접 연결 도메인 제거'");
  });

  it('recovers from a stale managed-route delete and identifies the delete target accessibly', () => {
    expect(detail).toContain("err.code === 'DOMAIN_MANAGED_BY_PUBLIC_ACCESS'");
    expect(detail).toContain('await refresh();');
    expect(detail).toContain("t('projectDetail.domains.removeAria', { domain: displayUrl })");
  });
});
