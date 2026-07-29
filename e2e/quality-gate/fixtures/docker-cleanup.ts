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
  instanceId: string,
): string[] {
  const rows = lines.trim().split('\n').filter(Boolean);

  const ids: string[] = [];
  for (const row of rows) {
    const [id, name, ownerInstanceId] = row.trim().split(/\s+/, 3);
    if (!id || !name || ownerInstanceId !== instanceId) continue;
    if (prefixes.some((prefix) => name.startsWith(prefix))) {
      ids.push(id);
    }
  }
  return ids;
}

function requireE2EInstanceId(): string {
  const instanceId = process.env['OPENLANDER_E2E_INSTANCE_ID']?.trim();
  if (!instanceId) {
    throw new Error('OPENLANDER_E2E_INSTANCE_ID is required for Docker cleanup');
  }
  return instanceId;
}

export function listContainerIdsByNamePrefix(
  prefixes: readonly string[],
  instanceId = requireE2EInstanceId(),
): string[] {
  const lines = execSync(
    'docker ps -a --format \'{{.ID}} {{.Names}} {{.Label "openlander.instance"}}\'',
    {
      encoding: 'utf-8',
    },
  );
  return listContainerIdsByNamePrefixFromLines(lines, prefixes, instanceId);
}

export function removeContainersByNamePrefix(
  prefixes: readonly string[],
  instanceId = requireE2EInstanceId(),
): void {
  const ids = listContainerIdsByNamePrefix(prefixes, instanceId);
  for (const id of ids) {
    execSync(`docker rm -f ${id}`, { stdio: 'pipe' });
  }
}
