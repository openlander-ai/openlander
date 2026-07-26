import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('public web vocabulary i18n', () => {
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('localizes Project resource and application actions in Korean', () => {
    expect(enSource).toContain("services: 'Resources'");
    expect(enSource).toContain("title: 'Add application'");
    expect(enSource).toContain("create: 'Create application'");
    expect(enSource).toContain("serviceName: 'Application name'");
    expect(enSource).toContain("backToServices: 'Back to Resources'");

    expect(koSource).toContain("services: '리소스'");
    expect(koSource).toContain("title: '애플리케이션 추가'");
    expect(koSource).toContain("create: '애플리케이션 만들기'");
    expect(koSource).toContain("serviceName: '애플리케이션 이름'");
    expect(koSource).toContain("backToServices: '리소스 목록으로 돌아가기'");
  });

  it('defines canonical resource display labels in both locales', () => {
    for (const source of [enSource, koSource]) {
      for (const key of ['application', 'compose', 'database', 'cache', 'storage', 'resource']) {
        expect(source).toContain(`${key}:`);
      }
    }
    expect(enSource).toContain("application: 'Application'");
    expect(enSource).toContain("compose: 'Compose'");
    expect(enSource).toContain("database: 'Database'");
    expect(enSource).toContain("cache: 'Cache'");
    expect(enSource).toContain("storage: 'Storage'");
    expect(koSource).toContain("application: '애플리케이션'");
    expect(koSource).toContain("compose: 'Docker Compose'");
    expect(koSource).toContain("database: '데이터베이스'");
    expect(koSource).toContain("cache: '캐시'");
    expect(koSource).toContain("storage: '스토리지'");
  });

  it('keeps compatibility service_id copy explicit without old product nouns', () => {
    for (const source of [enSource, koSource]) {
      expect(source).toContain('service_id');
      expect(source).not.toMatch(/Project group|Deployable service|Managed service/);
      expect(source).not.toMatch(/Create service|Add a service|Back to Services/);
    }
    expect(enSource).toContain('Application/Compose/Database/Cache/Storage');
    expect(koSource).toContain('애플리케이션, Compose 또는 데이터베이스·캐시·스토리지');
  });
});
