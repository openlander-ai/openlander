import type { McpServerEntry } from '../config/index.js';
import type { OpenLanderConfig } from '../config/index.js';
import { SEARXNG_DEFAULT_PORT } from './searxng.js';

/**
 * MCP Preset definitions.
 *
 * Built-in MCP servers that OpenLander manages automatically:
 * - SearXNG: Self-hosted web search (default: enabled)
 * - GitHub: GitHub API access via official MCP server (default: disabled, auto-enabled when PAT exists)
 */

export interface McpPresetConfig {
  searxng: { enabled: boolean };
  github: { enabled: boolean };
}

export const DEFAULT_PRESETS: McpPresetConfig = {
  searxng: { enabled: true },
  github: { enabled: false },
};

/**
 * Check if GitHub MCP should be auto-enabled.
 * Returns true when a GitHub PAT is configured but the GitHub preset is not explicitly enabled.
 */
export function shouldAutoEnableGithub(config: OpenLanderConfig): boolean {
  const hasToken = Boolean(config.gitProviders.github.token);
  const presets = config.mcp.presets ?? DEFAULT_PRESETS;
  return hasToken && !presets.github.enabled;
}

/**
 * Resolve preset configs into McpServerEntry[] ready for McpClientManager.
 *
 * @param config Full app config (reads presets + gitProviders.github.token)
 * @param searxngUrl URL of the running SearXNG instance
 * @returns Array of McpServerEntry for enabled presets
 */
export function resolvePresets(config: OpenLanderConfig, searxngUrl?: string): McpServerEntry[] {
  const presets = config.mcp.presets ?? DEFAULT_PRESETS;
  const entries: McpServerEntry[] = [];

  // SearXNG preset — stdio transport via mcp-searxng npm package
  if (presets.searxng.enabled) {
    const url = searxngUrl ?? `http://localhost:${String(SEARXNG_DEFAULT_PORT)}`;
    entries.push({
      id: 'preset-searxng',
      name: 'searxng',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-searxng'],
      env: { SEARXNG_URL: url },
      enabled: true,
    });
  }

  // GitHub preset — stdio transport via official GitHub MCP server binary
  const githubEnabled = presets.github.enabled || shouldAutoEnableGithub(config);
  if (githubEnabled && config.gitProviders.github.token) {
    entries.push({
      id: 'preset-github',
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: config.gitProviders.github.token },
      enabled: true,
    });
  }

  return entries;
}
