import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ServiceRepo.getDeployablesByGroup', () => {
  it('treats compose children as user-addressable deployables and excludes compose parent metadata', () => {
    const source = readFileSync('src/db/repos/service.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployablesByGroup'),
      source.indexOf('\n  }\n}', source.indexOf('async getDeployablesByGroup')),
    );

    expect(method).toContain("notInArray(services.kind, [...MANAGED_SERVICE_KINDS, 'compose'])");
    expect(method).toContain("${services.build_method} = 'compose'");
    expect(method).not.toContain("services.kind} != 'compose-child'");
  });
});
