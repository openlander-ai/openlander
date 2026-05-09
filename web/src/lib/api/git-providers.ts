/**
 * Git Providers API client — shapes the GitHub status surface used by
 * `web/src/pages/settings/GitProviders.tsx`. Mirrors the response of
 * `GET /api/git-providers/github` declared in
 * `src/web/api/git-providers-routes.ts`.
 *
 * v0.1: GitHub is the only provider with a live status endpoint. GitLab
 * and Bitbucket are surfaced as compressed v0.2 placeholder rows directly
 * in the page; they have no client function.
 */
import { apiGet } from './client';

export type GitHubAuthMethod = 'oauth' | 'pat';

export interface GitHubProviderStatus {
  /** True when a token is configured (independent of liveness). */
  connected: boolean;
  /**
   * Live `/user` validation result.
   *   true  — token accepted by GitHub
   *   false — token rejected (revoked / expired / invalid scope)
   *   null  — couldn't reach GitHub or check failed; treat as "unknown".
   *           This deliberately does NOT collapse into `connected=false`
   *           because a transient outage should not look identical to a
   *           revoked token.
   */
  tokenValid: boolean | null;
  login: string | null;
  authMethod: GitHubAuthMethod | null;
  /** GitHub OAuth scopes — only PAT/OAuth tokens reliably surface them. */
  scopes: string[];
  /**
   * Distinct count of GitHub repos referenced by active services.
   * `null` when the backend could not determine the count (DB read failed).
   * The page renders "—" instead of falling back to zero — a fabricated
   * zero would lie about state during a transient DB outage.
   */
  reposLinked: number | null;
  /** Timestamp tiles are null until the backend records a connect/sync event. */
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** Set when the live validation call returned an explicit error. */
  validationError: string | null;
}

export async function getGitHubProviderStatus(): Promise<GitHubProviderStatus> {
  return apiGet<GitHubProviderStatus>('/api/git-providers/github');
}
