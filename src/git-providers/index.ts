/**
 * Git provider factory.
 *
 * Creates the appropriate GitProvider instance from config.
 * Currently supports GitHub. GitLab, Bitbucket, Gitea can be added
 * by implementing the GitProvider interface and registering here.
 */

import type { GitProvider, GitProviderType, GitProviderConfig } from './types.js';
import { GitHubProvider } from './github.js';
import { GitLabProvider } from './gitlab.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('git');

export type {
  GitProvider,
  GitProviderType,
  GitProviderConfig,
  GitRepo,
  GitUser,
  TokenValidation,
} from './types.js';

/**
 * Create a GitProvider instance from a type and config.
 *
 * @throws Error if the provider type is not supported.
 */
export function createGitProvider(type: GitProviderType, config: GitProviderConfig): GitProvider {
  if (!config.token) {
    throw new Error(`No token configured for ${type} provider`);
  }

  switch (type) {
    case 'github':
      return new GitHubProvider(config.token, config.baseUrl, config.authMethod);
    case 'gitlab':
      return new GitLabProvider(config.token, config.baseUrl);
    default:
      throw new Error(`Unsupported git provider: ${type}. Supported: github, gitlab`);
  }
}

/**
 * Create all configured git providers from an OpenLander config.
 * Returns a map of type → provider for providers that have tokens set.
 */
export function createConfiguredProviders(
  gitProviders: Partial<Record<GitProviderType, GitProviderConfig>>,
): Map<GitProviderType, GitProvider> {
  const providers = new Map<GitProviderType, GitProvider>();

  for (const [type, config] of Object.entries(gitProviders)) {
    if (config.token) {
      try {
        const provider = createGitProvider(type as GitProviderType, config);
        providers.set(type as GitProviderType, provider);
      } catch (err) {
        log.debug({ err, type }, 'Failed to initialize git provider — skipping');
        // Skip providers that fail to initialize
      }
    }
  }

  return providers;
}

/**
 * Get the first available provider, preferring GitHub.
 * Returns null if no providers are configured.
 */
export function getDefaultProvider(
  providers: Map<GitProviderType, GitProvider>,
): GitProvider | null {
  // Prefer GitHub, then others in order
  const preferenceOrder: GitProviderType[] = ['github', 'gitlab', 'bitbucket', 'gitea'];
  for (const type of preferenceOrder) {
    const provider = providers.get(type);
    if (provider) return provider;
  }
  return null;
}
