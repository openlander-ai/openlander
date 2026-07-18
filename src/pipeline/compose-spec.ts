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
