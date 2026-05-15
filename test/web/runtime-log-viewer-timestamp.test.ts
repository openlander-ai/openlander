import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Runtime LogViewer timestamp metadata', () => {
  const source = readRepoFile('web/src/components/logs/LogViewer.tsx');

  it('renders Docker metadata timestamps as subdued metadata with a tooltip', () => {
    expect(source).toContain("title={t('logs.collectedAtTooltip')}");
    expect(source).toContain("aria-label={t('logs.collectedAtTooltip')}");
    expect(source).toContain('text-muted-foreground/35');
    expect(source).toContain('text-[11px]');
  });
});
