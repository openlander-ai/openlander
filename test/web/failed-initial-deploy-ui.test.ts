import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('failed initial deploy UI', () => {
  const gridSource = readRepoFile('web/src/pages/ProjectsGrid.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('distinguishes retained failed setup attempts from ordinary Projects', () => {
    expect(gridSource).toContain(
      'p.failedInitialDeploy === true || p.failed_initial_deploy === true',
    );
    expect(gridSource).toContain("t('projects.card.failedInitialDeployBadge')");
    expect(gridSource).toContain("t('projects.card.failedInitialDeployHint')");
  });

  it('explains evidence retention and approval-gated cleanup in both locales', () => {
    for (const key of ['failedInitialDeployBadge', 'failedInitialDeployHint']) {
      expect(enSource).toContain(key);
      expect(koSource).toContain(key);
    }
    expect(enSource).toContain('approval-gated cleanup');
    expect(koSource).toContain('승인 기반 정리');
  });
});
