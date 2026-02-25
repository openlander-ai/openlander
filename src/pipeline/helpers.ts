import { dirname } from 'node:path';

export function extractProjectName(repoUrl: string): string {
  const cleaned = repoUrl
    .replace(/\.git$/, '')
    .replace(/^(https?:\/\/|git@)/, '')
    .replace(/:/g, '/');

  const parts = cleaned.split('/');
  return parts[parts.length - 1] ?? 'project';
}

export function deriveServiceName(dockerfilePath: string): string {
  const dir = dirname(dockerfilePath);
  if (dir === '.' || dir === '') {
    return 'main';
  }

  return dir.split('/')[0] ?? 'service';
}
