/**
 * MCP client config snippet builders, shared by the setup wizard
 * (web/src/components/setup/McpGuideStep.tsx) and the Your Agent
 * page (web/src/pages/MCPServer.tsx). Single source of truth keeps
 * both surfaces aligned — when a new client is added or an existing
 * config schema shifts, both copy panels follow.
 */

export type McpClientId =
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'claude-desktop'
  | 'vscode'
  | 'stdio';

export interface McpClientConfig {
  id: McpClientId;
  label: string;
  filename?: string;
  snippet: string;
}

interface BuildOptions {
  endpoint: string;
  token: string;
}

export function buildClaudeCodeCmd({ endpoint, token }: BuildOptions): string {
  return `claude mcp add openlander --url ${endpoint} --header "Authorization: Bearer ${token}"`;
}

export function buildCursorConfig({ endpoint, token }: BuildOptions): string {
  return JSON.stringify(
    {
      mcpServers: {
        openlander: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function buildWindsurfConfig({ endpoint, token }: BuildOptions): string {
  return JSON.stringify(
    {
      mcpServers: {
        openlander: {
          serverUrl: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeDesktopConfig({ endpoint, token }: BuildOptions): string {
  return JSON.stringify(
    {
      mcpServers: {
        openlander: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpoint, '--header', `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  );
}

export function buildVscodeConfig({ endpoint, token }: BuildOptions): string {
  return JSON.stringify(
    {
      servers: {
        openlander: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpoint, '--header', `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  );
}

export const STDIO_CMD = 'openlander mcp';

/**
 * Returns the full set of client configs in the order they should
 * appear in the UI. The Setup card on the Your Agent page and the
 * Manual setup section of the setup wizard both walk this list.
 */
export function buildAllClientConfigs(opts: BuildOptions): McpClientConfig[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      snippet: buildClaudeCodeCmd(opts),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      filename: '.cursor/mcp.json',
      snippet: buildCursorConfig(opts),
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      filename: '~/.codeium/windsurf/mcp_config.json',
      snippet: buildWindsurfConfig(opts),
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      filename: 'claude_desktop_config.json',
      snippet: buildClaudeDesktopConfig(opts),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      filename: '.vscode/mcp.json',
      snippet: buildVscodeConfig(opts),
    },
    {
      id: 'stdio',
      label: 'stdio',
      snippet: STDIO_CMD,
    },
  ];
}
