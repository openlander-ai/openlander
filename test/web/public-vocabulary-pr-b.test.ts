import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('public web vocabulary i18n', () => {
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('uses Resources and Add application copy on the Project surface in both locales', () => {
    for (const source of [enSource, koSource]) {
      expect(source).toContain("services: 'Resources'");
      expect(source).toContain("title: 'Add application'");
      expect(source).toContain("create: 'Create application'");
      expect(source).toContain("serviceName: 'Application name'");
      expect(source).toContain("backToServices: 'Back to Resources'");
    }
  });

  it('defines canonical resource display labels in both locales', () => {
    for (const source of [enSource, koSource]) {
      for (const key of ['application', 'compose', 'database', 'cache', 'storage', 'resource']) {
        expect(source).toContain(`${key}:`);
      }
      expect(source).toContain("application: 'Application'");
      expect(source).toContain("compose: 'Compose'");
      expect(source).toContain("database: 'Database'");
      expect(source).toContain("cache: 'Cache'");
      expect(source).toContain("storage: 'Storage'");
    }
  });

  it('keeps compatibility service_id copy explicit without old product nouns', () => {
    for (const source of [enSource, koSource]) {
      expect(source).toContain('service_id');
      expect(source).toContain('Application/Compose/Database/Cache/Storage');
      expect(source).not.toMatch(/Project group|Deployable service|Managed service/);
      expect(source).not.toMatch(/Create service|Add a service|Back to Services/);
    }
  });
});
