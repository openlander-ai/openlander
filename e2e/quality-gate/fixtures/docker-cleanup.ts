import { execSync } from 'node:child_process';

export const E2E_CONTAINER_NAME_PREFIXES = [
  'ol-test-',
  'ol-golden-',
  'ol-qg-',
  'ol-qa-',
  'ol-mcp-',
  'ol-svc-test-',
  'ol-svc-golden-',
  'ol-svc-qg-',
  'ol-svc-qa-',
  'ol-svc-mcp-',
];

export function listContainerIdsByNamePrefixFromLines(
  lines: string,
  prefixes: readonly string[],
): string[] {
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

export function listContainerIdsByNamePrefix(prefixes: readonly string[]): string[] {
  const lines = execSync('docker ps -a --format "{{.ID}} {{.Names}}"', {
    encoding: 'utf-8',
  });
  return listContainerIdsByNamePrefixFromLines(lines, prefixes);
}

export function removeContainersByNamePrefix(prefixes: readonly string[]): void {
  const ids = listContainerIdsByNamePrefix(prefixes);
  for (const id of ids) {
    execSync(`docker rm -f ${id}`, { stdio: 'pipe' });
  }
}
