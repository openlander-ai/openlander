import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { ServiceConfigError } from '../errors.js';

/** Resolve a repository-relative Compose file without allowing path traversal. */
export function resolveComposeFilePath(repositoryPath: string, composeFile: string): string {
  const requested = composeFile.trim();
  if (!requested || isAbsolute(requested)) {
    throw new ServiceConfigError('Compose file must be a repository-relative path.', {
      composeFile,
    });
  }
  const resolvedPath = resolve(repositoryPath, requested);
  const relativePath = relative(repositoryPath, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || !existsSync(resolvedPath)) {
    throw new ServiceConfigError('Compose file must exist inside the repository.', {
      composeFile,
    });
  }
  return resolvedPath;
}

/** Resolve an ordered base-to-overlay Compose file list inside the repository. */
export function resolveComposeFilePaths(
  repositoryPath: string,
  composeFiles: readonly string[],
): string[] {
  if (composeFiles.length === 0) {
    throw new ServiceConfigError('At least one Compose file is required.', { composeFiles });
  }
  const resolved = composeFiles.map((composeFile) =>
    resolveComposeFilePath(repositoryPath, composeFile),
  );
  if (new Set(resolved).size !== resolved.length) {
    throw new ServiceConfigError('Compose files must not contain duplicates.', { composeFiles });
  }
  return resolved;
}
