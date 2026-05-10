/**
 * Git Providers — read-only status surface for the v0.1 Settings page.
 *
 * Backs `web/src/pages/settings/GitProviders.tsx`. The page asks one question:
 * "is GitHub connected, and if so, what does it know about itself?" This route
 * answers it while storing lightweight sync timestamps — login + auth method come from
 * `config.gitProviders.github`, scopes come from a live `/user` call, and
 * `reposLinked` is derived by walking the services table.
 *
 * v0.1 surface: Git Providers.
 */

import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { updateConfig } from '../../config/index.js';
import { createGitProvider } from '../../git-providers/index.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('git-providers-api');

export interface GitHubProviderStatus {
  /** True when a token is configured (independent of liveness). */
  connected: boolean;
  /**
   * Live `/user` validation result.
   *   true  — GitHub accepted the token
   *   false — GitHub rejected the token (revoked / expired / 401 / 403)
   *   null  — couldn't classify (network error, 5xx, timeout). Treat as
   *           "unknown"; do NOT collapse into `false` because a transient
   *           outage should not look identical to a revoked token.
   */
  tokenValid: boolean | null;
  login: string | null;
  authMethod: 'oauth' | 'pat' | null;
  scopes: string[];
  /**
   * Distinct count of GitHub repos referenced by active deployable
   * services. `null` means the database read failed and the count could
   * not be determined — the frontend renders "—" instead of a fabricated
   * zero (Codex CCG round 1 P2).
   */
  reposLinked: number | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  validationError: string | null;
}

/**
 * Parse a GitHub repo URL into its canonical `{ owner, repo }` form.
 * Returns `null` for non-GitHub URLs (gist.github.com, api.github.com,
 * subdomain spoofs like `github.com.evil.com`, etc).
 *
 * The previous regex over-matched (`gist.github.com`, `raw.github.com`,
 * even `https://evil.com/https://github.com/...`); this parser uses the
 * URL constructor / SSH form so the host has to be exactly `github.com`.
 */
export function parseGitHubRepo(
  url: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo[.git]
  const sshMatch = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return owner && repo ? { owner, repo } : null;
  }

  // https://github.com/owner/repo[.git] · ssh://git@github.com/owner/repo[.git]
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.host.toLowerCase() !== 'github.com') return null;
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length < 2) return null;
  const [owner, repoRaw] = segments;
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, '');
  if (!repo) return null;
  return { owner, repo };
}

export function canonicalRepoKey(parsed: { owner: string; repo: string }): string {
  return `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
}

/**
 * Categorize a `validateToken()` failure as either an explicit GitHub
 * rejection ("the token is bad") or an unreachable / unclassifiable
 * outage ("we don't know"). The provider wrapper in
 * `src/git-providers/github.ts` collapses every error into
 * `{ valid: false, error }`, so the route can't tell the two apart from
 * the boolean alone — we discriminate on the error message shape.
 */
export function classifyValidationError(message: string): 'rejected' | 'unreachable' {
  // The provider's request() helper throws specific error strings for 401 /
  // 403 / 404 — see src/git-providers/github.ts. Any 4xx is "GitHub said no";
  // 5xx + non-status messages collapse into "we couldn't ask GitHub".
  if (/Invalid or expired/i.test(message)) return 'rejected';
  if (/lacks required permissions/i.test(message)) return 'rejected';
  if (/resource not found/i.test(message)) return 'rejected';
  const apiStatus = /API error (\d{3})/i.exec(message);
  if (apiStatus) {
    const statusCode = apiStatus[1];
    if (!statusCode) return 'unreachable';
    const code = Number.parseInt(statusCode, 10);
    if (code >= 400 && code < 500) return 'rejected';
    return 'unreachable';
  }
  return 'unreachable';
}

async function countGitHubLinkedRepos(ctx: AppContext): Promise<number | null> {
  try {
    const services = await ctx.db.listServices();
    const repoSet = new Set<string>();
    for (const svc of services) {
      if (svc.source !== 'git') continue;
      if (svc.archived_at) continue;
      const parsed = parseGitHubRepo(svc.repo_url);
      if (!parsed) continue;
      repoSet.add(canonicalRepoKey(parsed));
    }
    return repoSet.size;
  } catch (err) {
    // Don't lie about the count — return null so the frontend renders "—"
    // instead of a fabricated zero (Codex CCG round 1 P2).
    log.debug({ err }, 'Failed to count GitHub-linked services');
    return null;
  }
}

function persistGitHubSuccessfulSync(
  ctx: AppContext,
  updates: { username?: string | null; syncedAt: string },
): void {
  const current = ctx.config.gitProviders.github;
  const next = {
    ...current,
    username: updates.username ?? current.username,
    connectedAt: current.connectedAt ?? updates.syncedAt,
    lastSyncAt: updates.syncedAt,
  };
  ctx.config.gitProviders.github = next;
  try {
    updateConfig({
      gitProviders: {
        github: {
          username: next.username,
          connectedAt: next.connectedAt,
          lastSyncAt: next.lastSyncAt,
        },
      },
    });
  } catch (err) {
    log.warn({ err }, 'Failed to persist GitHub provider sync timestamps');
  }
}

export function createGitProvidersRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/git-providers/github', async (c) => {
    const ghConfig = ctx.config.gitProviders.github;
    const token = ghConfig.token;

    if (!token) {
      const empty: GitHubProviderStatus = {
        connected: false,
        tokenValid: null,
        login: null,
        authMethod: null,
        scopes: [],
        reposLinked: 0,
        connectedAt: null,
        lastSyncAt: null,
        validationError: null,
      };
      return c.json(empty);
    }

    let scopes: string[] = [];
    let tokenValid: boolean | null = null;
    let validationError: string | null = null;
    try {
      const provider = createGitProvider('github', ghConfig);
      const validation = await provider.validateToken();
      scopes = validation.scopes;
      if (validation.valid) {
        tokenValid = true;
        persistGitHubSuccessfulSync(ctx, {
          username: validation.user?.username ?? ghConfig.username,
          syncedAt: new Date().toISOString(),
        });
      } else {
        const errMsg = validation.error ?? 'Token validation failed';
        validationError = errMsg;
        // Discriminate "GitHub said no" from "we couldn't ask GitHub".
        // The GitHubProvider wrapper swallows network errors and returns
        // valid=false, so without this classifier a DNS / 5xx outage
        // would render as a revoked-token state (Codex CCG round 1 P1).
        tokenValid = classifyValidationError(errMsg) === 'rejected' ? false : null;
      }
    } catch (err) {
      tokenValid = null;
      validationError = err instanceof Error ? err.message : 'Validation failed';
      log.debug({ err }, 'GitHub validateToken threw');
    }

    const reposLinked = await countGitHubLinkedRepos(ctx);

    const status: GitHubProviderStatus = {
      connected: true,
      tokenValid,
      login: ctx.config.gitProviders.github.username || null,
      authMethod: ctx.config.gitProviders.github.authMethod ?? null,
      scopes,
      reposLinked,
      connectedAt: ctx.config.gitProviders.github.connectedAt ?? null,
      lastSyncAt: ctx.config.gitProviders.github.lastSyncAt ?? null,
      validationError,
    };
    return c.json(status);
  });

  return api;
}
