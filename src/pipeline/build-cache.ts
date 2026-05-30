import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export interface DependencyCacheKey {
  key: string;
  reason: 'git_dependency';
}

export function createDependencyCacheKey(options: {
  repoPath: string;
  commitSha: string;
  volatileSalt: number | string;
  dependencyPaths?: Array<string | undefined>;
}): DependencyCacheKey | null {
  if (!hasGitDependencySpec(options.repoPath, options.dependencyPaths)) {
    return null;
  }

  return {
    key: `git-dependency:${options.commitSha}:${String(options.volatileSalt)}`,
    reason: 'git_dependency',
  };
}

export function hasGitDependencySpec(
  repoPath: string,
  dependencyPaths: Array<string | undefined> = [],
): boolean {
  return dependencyRoots(repoPath, dependencyPaths).some(
    (root) =>
      packageJsonHasGitDependency(join(root, 'package.json')) ||
      requirementsHasGitDependency(join(root, 'requirements.txt')) ||
      pyprojectHasGitDependency(join(root, 'pyproject.toml')),
  );
}

export function isGitDependencySpecifier(value: string): boolean {
  const spec = value.trim();
  if (!spec) return false;
  if (/^(?:\.{1,2}\/|\/)/.test(spec)) return false;

  return (
    /^(?:git\+|git:\/\/|git@|ssh:\/\/git@)/i.test(spec) ||
    /^(?:github|gitlab|bitbucket):[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(spec) ||
    /^https:\/\/(?:github|gitlab|bitbucket)\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?(?:[#?].*)?$/i.test(
      spec,
    ) ||
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.+)?$/.test(spec)
  );
}

function packageJsonHasGitDependency(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) return false;

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = parsed[field];
      if (!isDependencyMap(dependencies)) continue;
      if (Object.values(dependencies).some((value) => isGitDependencySpecifier(value))) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function dependencyRoots(repoPath: string, dependencyPaths: Array<string | undefined>): string[] {
  const repoRoot = resolve(repoPath);
  const roots = new Set<string>([repoRoot]);

  for (const candidate of dependencyPaths) {
    if (!candidate || candidate.trim().length === 0) continue;

    const resolved = resolve(repoRoot, candidate);
    const rel = relative(repoRoot, resolved);
    if (rel.startsWith('..') || rel === '..' || rel === '') {
      continue;
    }

    try {
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        roots.add(resolved);
      } else if (stat.isFile()) {
        roots.add(dirname(resolved));
      }
    } catch {
      // Missing Dockerfile/build contexts are reported by the build step. Cache
      // hints should stay best-effort and never fail deployment planning.
    }
  }

  return [...roots];
}

function isDependencyMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((dependency) => typeof dependency === 'string')
  );
}

function requirementsHasGitDependency(requirementsPath: string): boolean {
  if (!existsSync(requirementsPath)) return false;

  const content = readFileSync(requirementsPath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .some((line) => {
      const spec =
        line
          .replace(/^-e\s+/, '')
          .split(/\s+#/, 1)[0]
          ?.trim() ?? '';
      return isGitDependencySpecifier(spec);
    });
}

function pyprojectHasGitDependency(pyprojectPath: string): boolean {
  if (!existsSync(pyprojectPath)) return false;

  const lines = readFileSync(pyprojectPath, 'utf8').split(/\r?\n/);
  let inDependencyArray = false;
  let inPoetryDependencies = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const table = line.match(/^\[([^\]]+)\]$/)?.[1];
    if (table) {
      inPoetryDependencies =
        table === 'tool.poetry.dependencies' || table === 'tool.poetry.group.dev.dependencies';
      inDependencyArray = false;
      continue;
    }

    if (/^(?:dependencies|optional-dependencies)\s*=/.test(line)) {
      inDependencyArray = line.includes('[') && !line.includes(']');
      if (quotedValues(line).some(isGitDependencySpecifier)) {
        return true;
      }
      continue;
    }

    if (inDependencyArray) {
      if (quotedValues(line).some(isGitDependencySpecifier)) {
        return true;
      }
      if (line.includes(']')) {
        inDependencyArray = false;
      }
    }

    if (inPoetryDependencies && quotedValues(line).some(isGitDependencySpecifier)) {
      return true;
    }
  }

  return false;
}

function quotedValues(line: string): string[] {
  return Array.from(line.matchAll(/["']([^"']+)["']/g), (match) => match[1]).filter(
    (value): value is string => value !== undefined,
  );
}
