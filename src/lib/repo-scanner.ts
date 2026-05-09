import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RepoShapeScanResult {
  dockerfiles: string[];
  composeFiles: string[];
  hasRootDockerfile: boolean;
}

export function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') continue;

      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && (entry === 'Dockerfile' || entry.startsWith('Dockerfile.'))) {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch {
        continue;
      }
    }
  }

  walk(dir, 0);
  return results;
}

export function scanRepoShape(clonePath: string): RepoShapeScanResult {
  const dockerfiles = findDockerfiles(clonePath, 3);
  const composeFiles: string[] = [];
  const composeFilenames = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ];

  for (const filename of composeFilenames) {
    const candidatePath = join(clonePath, filename);
    try {
      if (statSync(candidatePath).isFile()) {
        composeFiles.push(candidatePath);
      }
    } catch {
      continue;
    }
  }

  const hasRootDockerfile = dockerfiles.some(
    (dockerfilePath) => dockerfilePath === join(clonePath, 'Dockerfile'),
  );

  return {
    dockerfiles,
    composeFiles,
    hasRootDockerfile,
  };
}
