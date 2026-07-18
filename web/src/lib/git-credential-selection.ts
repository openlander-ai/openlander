import type { GitCredential } from './api/git-credentials';

/** Keep an explicit verified selection, otherwise select only one exact match. */
export function selectMatchingGitCredential(
  credentials: GitCredential[],
  currentId: string,
): string {
  const verified = credentials.filter((credential) => credential.status === 'verified');
  if (verified.some((credential) => credential.id === currentId)) return currentId;
  return verified.length === 1 ? verified[0]!.id : '';
}
