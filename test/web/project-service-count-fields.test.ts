import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('project service count fields', () => {
  const typesSource = readRepoFile('web/src/types/index.ts');
  const homeSource = readRepoFile('web/src/pages/Home.tsx');
  const projectsGridSource = readRepoFile('web/src/pages/ProjectsGrid.tsx');
  const projectMapperSource = readRepoFile('web/src/lib/projectMappers.ts');

  it('documents serviceCount as a total-count compatibility field', () => {
    expect(typesSource).toContain('Legacy total service count kept for wire compatibility');
    expect(typesSource).toContain('totalServiceCount?: number');
    expect(typesSource).not.toContain('Legacy alias for deployableServiceCount');
  });

  it('does not use total serviceCount as a deployable-count fallback', () => {
    for (const source of [homeSource, projectsGridSource, projectMapperSource]) {
      expect(source).not.toContain('deployableServiceCount ?? p.serviceCount');
      expect(source).not.toContain('deployableServiceCount ?? p.serviceCount ?? 0');
      expect(source).not.toContain('p.deployableServiceCount ?? p.serviceCount');
      expect(source).not.toContain('p.deployableServiceCount ?? p.serviceCount ?? 0');
    }
  });

  it('uses total service count for user-facing project summaries', () => {
    for (const source of [homeSource, projectsGridSource, projectMapperSource]) {
      expect(source).toContain('p.totalServiceCount ?? p.serviceCount ?? p.deployableServiceCount');
    }

    expect(homeSource).toContain("pluralCount('services', totalServices)");
    expect(projectsGridSource).toContain("'common.count.services_one'");
    expect(projectsGridSource).toContain("'common.count.services_other'");
    expect(projectMapperSource).toContain('`${serviceCount} service');
  });
});
