import { useState, useEffect } from 'react';
import {
  Cable,
  Zap,
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { getApiToken } from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { useCopy } from '@/hooks/use-copy';

function CodeBlock({ label, code, mono = true }: { label: string; code: string; mono?: boolean }) {
  const { copy, isCopied } = useCopy();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-body text-secondary-ol font-medium">{label}</p>
      <div className="relative rounded-md bg-bg-app border border-border p-3">
        <pre
          className={`text-xs ${mono ? 'font-mono' : 'font-body'} text-primary-ol whitespace-pre-wrap break-all pr-16 overflow-auto max-h-48`}
        >
          {code}
        </pre>
        <button
          onClick={() => void copy(code)}
          className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-bg-subtle hover:bg-bg-subtle/80 text-muted-ol hover:text-secondary-ol transition-colors"
        >
          {isCopied() ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          {isCopied() ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function CollapsibleConfig({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-app transition-colors">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-body text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle transition-colors"
      >
        <span className="font-medium">{title}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3 bg-bg-app">{children}</div>
      )}
    </div>
  );
}

export function McpSettingsTab() {
  const { t } = useLanguage();
  const [apiToken, setApiToken] = useState<string>('');
  const { copy, isCopied } = useCopy();

  useEffect(() => {
    getApiToken()
      .then((res) => setApiToken(res.token))
      .catch(() => {});
  }, []);

  const host = window.location.hostname;
  const port = window.location.port || '10114';
  const mcpUrl = `http://${host}:${port}/mcp`;
  const token = apiToken || 'ol_YOUR_TOKEN';

  const quickCopyText = `Connect the OpenLander MCP server.\nURL: ${mcpUrl}\nToken: ${apiToken || 'loading...'}`;

  const claudeCodeCmd = `claude mcp add openlander --url ${mcpUrl} --header "Authorization: Bearer ${token}"`;

  const openCodeConfig = JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        openlander: {
          type: 'remote',
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
          enabled: true,
        },
      },
    },
    null,
    2,
  );

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        openlander: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  const windsurfConfig = JSON.stringify(
    {
      mcpServers: {
        openlander: {
          serverUrl: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        openlander: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  );

  const vscodeConfig = JSON.stringify(
    {
      servers: {
        openlander: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  );

  const stdioCmd = 'openlander mcp';

  return (
    <div className="space-y-6">
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-agent" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.mcp.serverTitle')}
          </h2>
        </div>
        <p className="text-xs font-body text-muted-ol">{t('settings.mcp.serverDescription')}</p>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/50 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-body font-medium text-secondary-ol w-20 shrink-0">
              {t('settings.mcp.url')}
            </span>
            <code className="flex-1 text-sm font-mono text-primary-ol bg-bg-app rounded px-3 py-1.5 border border-border truncate">
              {mcpUrl}
            </code>
            <button
              onClick={() => void copy(mcpUrl)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-body rounded border border-border bg-bg-app hover:bg-bg-subtle text-secondary-ol hover:text-primary-ol transition-colors shrink-0"
            >
              {isCopied() ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {isCopied() ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-body font-medium text-secondary-ol w-20 shrink-0">
              {t('settings.mcp.token')}
            </span>
            <code className="flex-1 text-sm font-mono text-muted-ol bg-bg-app rounded px-3 py-1.5 border border-border truncate">
              {apiToken ? `${apiToken.slice(0, 7)}••••••••${apiToken.slice(-4)}` : '••••••••••••'}
            </code>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const securityTab = document.querySelector(
                  '[data-state][value="security"]',
                ) as HTMLElement;
                securityTab?.click();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-body rounded border border-border bg-bg-app hover:bg-bg-subtle text-secondary-ol hover:text-primary-ol transition-colors shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t('settings.mcp.manageToken')}
            </a>
          </div>
        </div>
      </section>

      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-agent" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.mcp.quickSetupTitle')}
          </h2>
        </div>
        <p className="text-xs font-body text-muted-ol">{t('settings.mcp.quickSetupDescription')}</p>

        <CodeBlock label={t('settings.mcp.copyPrompt')} code={quickCopyText} />
      </section>

      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-agent" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.mcp.ideTitle')}
          </h2>
        </div>
        <p className="text-xs font-body text-muted-ol">{t('settings.mcp.ideDescription')}</p>

        <div className="space-y-2">
          <CollapsibleConfig title="Claude Code">
            <CodeBlock label={t('settings.mcp.runInTerminal')} code={claudeCodeCmd} />
          </CollapsibleConfig>

          <CollapsibleConfig title="OpenCode">
            <CodeBlock label="opencode.json" code={openCodeConfig} />
          </CollapsibleConfig>

          <CollapsibleConfig title="Cursor">
            <CodeBlock label=".cursor/mcp.json" code={cursorConfig} />
          </CollapsibleConfig>

          <CollapsibleConfig title="Windsurf">
            <CodeBlock label="~/.codeium/windsurf/mcp_config.json" code={windsurfConfig} />
          </CollapsibleConfig>

          <CollapsibleConfig title="Claude Desktop">
            <CodeBlock label="claude_desktop_config.json" code={claudeDesktopConfig} />
          </CollapsibleConfig>

          <CollapsibleConfig title="VS Code">
            <CodeBlock label=".vscode/mcp.json" code={vscodeConfig} />
          </CollapsibleConfig>

          <CollapsibleConfig title={t('settings.mcp.stdioLabel')}>
            <CodeBlock label={t('settings.mcp.runInTerminal')} code={stdioCmd} />
            <p className="text-xs font-body text-muted-ol">{t('settings.mcp.stdioHint')}</p>
          </CollapsibleConfig>
        </div>
      </section>
    </div>
  );
}
