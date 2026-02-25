/**
 * Git provider abstraction layer.
 *
 * Defines a common interface for repository hosting services.
 * GitHub is the first implementation. GitLab, Bitbucket, Gitea can follow
 * the same interface without changing agent tools or TUI code.
 */

// --- Repository ---

export interface GitRepo {
  /** Short name (e.g. "my-api") */
  name: string;
  /** Full qualified name (e.g. "user/my-api") */
  fullName: string;
  /** Human-readable description */
  description: string | null;
  /** Web URL for browser (e.g. "https://github.com/user/my-api") */
  htmlUrl: string;
  /** HTTPS clone URL */
  cloneUrl: string;
  /** SSH clone URL */
  sshUrl: string;
  /** Whether the repo is private */
  isPrivate: boolean;
  /** Default branch name */
  defaultBranch: string;
  /** Primary language (e.g. "TypeScript") */
  language: string | null;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
  /** Star count (or equivalent) */
  stars: number;
  /** Which provider this repo is from */
  provider: GitProviderType;
}

// --- User ---

export interface GitUser {
  /** Username / login handle */
  username: string;
  /** Display name */
  displayName: string | null;
  /** Avatar URL */
  avatarUrl: string;
  /** Number of public repos */
  publicRepoCount: number;
  /** Number of private repos (if available) */
  privateRepoCount: number;
}

// --- Token validation ---

export interface TokenValidation {
  valid: boolean;
  user: GitUser | null;
  /** OAuth scopes or permission level */
  scopes: string[];
  error?: string;
}

// --- List/Search options ---

export interface ListReposOptions {
  page?: number;
  perPage?: number;
  sort?: 'pushed' | 'updated' | 'created' | 'name';
  visibility?: 'all' | 'public' | 'private';
}

export interface SearchReposOptions {
  page?: number;
  perPage?: number;
}

export interface ListReposResult {
  repos: GitRepo[];
  hasMore: boolean;
}

export interface SearchReposResult {
  repos: GitRepo[];
  total: number;
}

// --- Provider types ---

export type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'gitea';

// --- Provider interface ---

/**
 * Common interface for all git hosting providers.
 *
 * Each provider (GitHub, GitLab, Bitbucket, Gitea) implements this interface.
 * Agent tools and TUI code interact with this — never with provider-specific APIs.
 */
export interface GitProvider {
  /** Provider identifier */
  readonly type: GitProviderType;

  /** Human-readable name (e.g. "GitHub", "GitLab Self-Hosted") */
  readonly displayName: string;

  /**
   * Validate the stored token and return user info.
   * Called during setup to verify the token works.
   */
  validateToken(): Promise<TokenValidation>;

  /**
   * List repositories accessible to the authenticated user.
   * Sorted by most recently pushed by default.
   */
  listRepos(opts?: ListReposOptions): Promise<ListReposResult>;

  /**
   * Search repositories by name/description.
   * Scoped to the authenticated user's accessible repos.
   */
  searchRepos(query: string, opts?: SearchReposOptions): Promise<SearchReposResult>;

  /**
   * Get a single repository by owner and name.
   * @throws if not found or not accessible.
   */
  getRepo(owner: string, name: string): Promise<GitRepo>;

  /**
   * Check if a repo has a Dockerfile at the root (or specified path).
   */
  hasDockerfile(owner: string, name: string, branch?: string): Promise<boolean>;

  /**
   * Build an authenticated HTTPS clone URL for private repos.
   * The token is embedded in the URL for git clone.
   */
  getAuthCloneUrl(repoFullName: string): string;
}

// --- Provider config ---

/**
 * Configuration for a single git provider instance.
 * Stored in ~/.openlander/config.json under gitProviders.{type}.
 */
export interface GitProviderConfig {
  /** Personal Access Token or API token */
  token: string;
  /** Cached username from last validation */
  username: string;
  /** Base API URL (for self-hosted instances like GitLab CE) */
  baseUrl?: string;
}
