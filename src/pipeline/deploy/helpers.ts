import { dirname, join, resolve } from 'node:path';

export interface PendingFixPatch {
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface PendingFixPayload {
  filePath: string;
  content?: string;
  patches?: PendingFixPatch[];
}

export function parsePendingFix(rawPendingFix: string): PendingFixPayload | null {
  try {
    const parsed = JSON.parse(rawPendingFix) as Record<string, unknown>;
    if (typeof parsed.filePath !== 'string') {
      return null;
    }

    if (typeof parsed.content === 'string') {
      return {
        filePath: parsed.filePath,
        content: parsed.content,
      };
    }

    if (Array.isArray(parsed.patches)) {
      const patches = parsed.patches as Array<Record<string, unknown>>;
      const validPatches = patches
        .filter((patch) => {
          return typeof patch.pattern === 'string' && typeof patch.replacement === 'string';
        })
        .map((patch) => ({
          pattern: patch.pattern as string,
          replacement: patch.replacement as string,
          flags: typeof patch.flags === 'string' ? patch.flags : 'gm',
        }));
      if (validPatches.length > 0) {
        return {
          filePath: parsed.filePath,
          patches: validPatches,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function detectFailStep(buildLog: string): string {
  if (!buildLog.includes('[clone]')) return 'clone';
  if (!buildLog.includes('[dockerfile]')) return 'dockerfile';
  if (!buildLog.includes('[build]')) return 'build';
  if (!buildLog.includes('[run]')) return 'run';
  if (
    buildLog.includes('Container crashed after start') ||
    buildLog.includes('Container failed readiness check')
  ) {
    return 'runtime';
  }
  return 'unknown';
}

export function resolveDockerfilePath(clonePath: string, dockerfilePath?: string): string {
  if (!dockerfilePath || dockerfilePath.trim().length === 0) {
    return join(clonePath, 'Dockerfile');
  }

  const normalizedPath = dockerfilePath.trim().replace(/\\/g, '/');
  if (normalizedPath.startsWith('/')) {
    throw new Error('Dockerfile path must be relative');
  }

  const cloneRoot = resolve(clonePath);
  const targetPath = resolve(clonePath, normalizedPath);
  if (!targetPath.startsWith(`${cloneRoot}/`) && targetPath !== cloneRoot) {
    throw new Error('Dockerfile path escaped repository root');
  }

  return targetPath;
}

export function deriveServiceName(dockerfilePath: string): string {
  const dir = dirname(dockerfilePath);
  if (dir === '.' || dir === '') return 'app';
  return dir.split('/')[0] ?? 'app';
}

export function getRouteName(projectName: string, _environmentType?: string): string {
  return projectName;
}
