import { dirname, join, resolve } from 'node:path';

interface PendingFixPayload {
  filePath: string;
  content: string;
}

export function parsePendingFix(rawPendingFix: string): PendingFixPayload | null {
  try {
    const parsed = JSON.parse(rawPendingFix) as Record<string, unknown>;
    if (typeof parsed.filePath !== 'string' || typeof parsed.content !== 'string') {
      return null;
    }
    return {
      filePath: parsed.filePath,
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

export function detectFailStep(buildLog: string): string {
  if (!buildLog.includes('[clone]')) return 'clone';
  if (!buildLog.includes('[dockerfile]')) return 'dockerfile';
  if (!buildLog.includes('[build]')) return 'build';
  if (!buildLog.includes('[run]')) return 'run';
  if (buildLog.includes('Container crashed after start')) return 'runtime';
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
  if (dir === '.' || dir === '') return 'main';
  return dir.split('/')[0] ?? 'service';
}

export function getRouteName(projectName: string, environmentType: string): string {
  if (environmentType === 'production') {
    return projectName;
  }
  if (environmentType === 'development') {
    return `${projectName}-dev`;
  }
  return `${projectName}-${environmentType}`;
}
