import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveServiceName } from '../../web/src/lib/service-name';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Add Service v5.1 surface', () => {
  const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const addServiceDialogSource = readRepoFile('web/src/components/project/AddServiceDialog.tsx');
  const projectsApiSource = readRepoFile('web/src/lib/api/projects.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('uses the native Add Service dialog from ProjectView', () => {
    expect(projectViewSource).toContain('<AddServiceDialog');
    expect(projectViewSource).toContain('projectId={projectId}');
    expect(projectViewSource).toContain('projectName={realProject.name}');
    expect(projectViewSource).not.toContain('kind="add-service"');
  });

  it('offers git and image service sources through the canonical deploy endpoint', () => {
    expect(addServiceDialogSource).toContain("type SourceKind = 'git' | 'image' | 'template'");
    expect(addServiceDialogSource).toContain("source: 'git'");
    expect(addServiceDialogSource).toContain("source: 'image'");
    expect(addServiceDialogSource).toContain('projectId,');
    expect(addServiceDialogSource).toContain('serviceName: effectiveServiceName');

    expect(projectsApiSource).toContain('export async function deployService');
    expect(projectsApiSource).toContain("'/api/services/deploy'");
    expect(projectsApiSource).toContain('project_id: input.projectId');
  });
});

describe('deriveServiceName', () => {
  it('handles plain git URLs', () => {
    expect(deriveServiceName('https://github.com/org/repo', 'git')).toBe('repo');
    expect(deriveServiceName('https://github.com/org/repo.git', 'git')).toBe('repo');
    expect(deriveServiceName('git@github.com:org/repo.git', 'git')).toBe('repo');
  });

  it('strips image tags before taking the path tail', () => {
    // Codex CCG flagged this — pre-fix: ghcr.io/owner/name:tag → "tag".
    expect(deriveServiceName('ghcr.io/owner/name:tag', 'image')).toBe('name');
    expect(deriveServiceName('postgres:16-alpine', 'image')).toBe('postgres');
    expect(deriveServiceName('nginx:alpine', 'image')).toBe('nginx');
    expect(deriveServiceName('docker.io/library/redis:7', 'image')).toBe('redis');
  });

  it('strips digests before tags so @sha256:... does not split incorrectly', () => {
    expect(deriveServiceName('ghcr.io/owner/name@sha256:abc123', 'image')).toBe('name');
    expect(deriveServiceName('postgres:16@sha256:deadbeef', 'image')).toBe('postgres');
  });

  it('preserves host:port registry refs without mangling the host', () => {
    // The colon AFTER the last `/` is the tag separator. Colons in
    // host:port (before the last `/`) must not be treated as tag.
    expect(deriveServiceName('localhost:5000/team/svc:v2', 'image')).toBe('svc');
    expect(deriveServiceName('registry.example.com:443/owner/app:1.0.0', 'image')).toBe('app');
  });

  it('returns an empty string for empty / only-special-character inputs', () => {
    expect(deriveServiceName('', 'git')).toBe('');
    expect(deriveServiceName('   ', 'git')).toBe('');
    expect(deriveServiceName('!!!', 'git')).toBe('');
    expect(deriveServiceName('', 'image')).toBe('');
  });

  it('lowercases and slug-normalizes the tail', () => {
    expect(deriveServiceName('https://github.com/Org/My_Cool_Repo', 'git')).toBe('my-cool-repo');
  });
});

describe('Image source: command field is gone (v0.1 spec drift fix)', () => {
  const addServiceDialogSource = readRepoFile('web/src/components/project/AddServiceDialog.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('does not render or wire an image Command field', () => {
    expect(addServiceDialogSource).not.toMatch(/imageCmd/);
    expect(addServiceDialogSource).not.toMatch(/addService\.command/);
  });

  it('drops the projectDetail.addService.command i18n key in both languages', () => {
    // The `command:` key still exists at top level (settings/cli).
    // Inside `projectDetail.addService` it should be gone.
    const enAddServiceBlock =
      enSource.match(/addService:\s*\{[\s\S]*?\n {4}\},/)?.[0] ?? '';
    const koAddServiceBlock =
      koSource.match(/addService:\s*\{[\s\S]*?\n {4}\},/)?.[0] ?? '';
    expect(enAddServiceBlock).not.toMatch(/^\s*command:/m);
    expect(koAddServiceBlock).not.toMatch(/^\s*command:/m);
  });
});

describe('i18n polish (Gemini CCG)', () => {
  const koSource = readRepoFile('web/src/i18n/ko.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');

  it('localizes the Soon tag to Korean instead of leaving the English word', () => {
    // Gemini CCG flagged "Soon" left in ko.ts as English residue.
    const koAddServiceBlock =
      koSource.match(/addService:\s*\{[\s\S]*?\n {4}\},/)?.[0] ?? '';
    expect(koAddServiceBlock).toMatch(/soon: ['"]곧 출시['"]/);
  });

  it('lists the planned templates so users know what is coming', () => {
    expect(enSource).toMatch(/Postgres, Redis, n8n, Plausible, Umami/);
    expect(koSource).toMatch(/Postgres, Redis, n8n, Plausible, Umami/);
  });

  it('warns about :latest drift on the image reference hint', () => {
    expect(enSource).toMatch(/:latest can drift/);
    expect(koSource).toMatch(/:latest는 배포마다 달라질/);
  });
});
