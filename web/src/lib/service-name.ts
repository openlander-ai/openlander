/**
 * Derive a default service name from a git URL or image reference.
 *
 * git URLs go through plain path-tail extraction:
 *   git@github.com:org/repo.git -> repo
 *   https://github.com/org/repo -> repo
 *
 * Image refs need the `:tag` (and any `@digest`) stripped first so the
 * tail is the image short-name, not the tag:
 *   ghcr.io/owner/name:tag -> name
 *   postgres:16-alpine     -> postgres
 *   nginx:alpine           -> nginx
 *
 * Empty / only-special-character inputs return '' so the caller can
 * fall back to the user's explicit serviceName entry.
 */
export function deriveServiceName(value: string, kind: 'git' | 'image' = 'git'): string {
  let cleaned = value.trim();
  if (!cleaned) return '';
  if (kind === 'image') {
    // Drop digest first, then drop tag. Order matters because @sha256:...
    // contains a `:` and would split incorrectly otherwise.
    const atIndex = cleaned.indexOf('@');
    if (atIndex >= 0) cleaned = cleaned.slice(0, atIndex);
    const colonIndex = cleaned.lastIndexOf(':');
    // Treat colon as a tag separator only when it appears after the last
    // `/` so `host:port/path` registry refs are not mangled.
    const lastSlash = cleaned.lastIndexOf('/');
    if (colonIndex > lastSlash) cleaned = cleaned.slice(0, colonIndex);
  } else {
    cleaned = cleaned.replace(/\.git$/i, '');
  }
  const tail = cleaned.split(/[/:]/).filter(Boolean).at(-1) ?? '';
  return tail
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
