import { execSync } from 'node:child_process';

export function listContainerIdsByNamePrefixFromLines(lines: string, prefixes: string[]): string[] {
  const rows = lines.trim().split('\n').filter(Boolean);

  const ids: string[] = [];
  for (const row of rows) {
    const [id, name] = row.trim().split(/\s+/, 2);
    if (!id || !name) continue;
    if (prefixes.some((prefix) => name.startsWith(prefix))) {
      ids.push(id);
    }
  }
  return ids;
}

export function listContainerIdsByNamePrefix(prefixes: string[]): string[] {
  const lines = execSync('docker ps -a --format "{{.ID}} {{.Names}}"', {
    encoding: 'utf-8',
  });
  return listContainerIdsByNamePrefixFromLines(lines, prefixes);
}

export function removeContainersByNamePrefix(prefixes: string[]): void {
  const ids = listContainerIdsByNamePrefix(prefixes);
  for (const id of ids) {
    execSync(`docker rm -f ${id}`, { stdio: 'pipe' });
  }
}
