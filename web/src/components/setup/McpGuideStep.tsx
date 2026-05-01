import { useState, useEffect } from 'react';
import { Zap, ChevronDown, ChevronUp, ChevronRight, Rocket, ArrowLeft } from 'lucide-react';
import { getApiToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CopyButton } from './shared';
import { useLanguage } from '@/i18n/context';

interface McpGuideStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function McpGuideStep({ onNext, onBack }: McpGuideStepProps) {
  const { t } = useLanguage();
  const [apiToken, setApiToken] = useState<string>('');
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    getApiToken()
      .then((res) => setApiToken(res.token))
      .catch(() => {
        /* token not yet available */
      });
  }, []);

  const host = window.location.hostname;
  const port = window.location.port || '10114';
  const mcpUrl = `http://${host}:${port}/mcp`;

  const quickCopyText = `Connect the OpenLander MCP server.\nURL: ${mcpUrl}\nToken: ${apiToken || 'loading...'}`;

  const claudeCodeCmd = `claude mcp add openlander --url ${mcpUrl} --header "Authorization: Bearer ${apiToken || 'ol_YOUR_TOKEN'}"`;
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        openlander: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${apiToken || 'ol_YOUR_TOKEN'}` },
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
          headers: { Authorization: `Bearer ${apiToken || 'ol_YOUR_TOKEN'}` },
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
          args: [
            '-y',
            'mcp-remote',
            mcpUrl,
            '--header',
            `Authorization: Bearer ${apiToken || 'ol_YOUR_TOKEN'}`,
          ],
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
          args: [
            '-y',
            'mcp-remote',
            mcpUrl,
            '--header',
            `Authorization: Bearer ${apiToken || 'ol_YOUR_TOKEN'}`,
          ],
        },
      },
    },
    null,
    2,
  );
  const stdioCmd = `openlander mcp`;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
          <Zap className="h-8 w-8 text-agent" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-foreground tracking-tight">
            {t('setup.mcp.title')}
          </h2>
          <p className="text-sm font-body text-foreground/80">{t('setup.mcp.subtitle')}</p>
        </div>

        {/* Quick copy block */}
        <div className="space-y-2 text-left">
          <p className="text-sm font-body text-foreground/80">{t('setup.mcp.copyPrompt')}</p>
          <div className="relative bg-bg-panel border border-border rounded-lg p-4">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all pr-8">
              {quickCopyText}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={quickCopyText} />
            </div>
          </div>
        </div>

        {/* Collapsible manual setup */}
        <div className="border border-border rounded-lg overflow-hidden text-left">
          <button
            type="button"
            onClick={() => setShowManual(!showManual)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-body text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronRight className="h-4 w-4" /> {t('setup.mcp.manualSetup')}
            </span>
            {showManual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showManual && (
            <div className="px-4 pb-4 space-y-4 border-t border-border">
              <div className="space-y-1 pt-3">
                <p className="text-xs font-body text-foreground/80 font-medium">Claude Code</p>
                <div className="relative bg-bg-app rounded p-3">
                  <code className="text-xs font-mono text-foreground break-all pr-8 block">
                    {claudeCodeCmd}
                  </code>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={claudeCodeCmd} />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-body text-foreground/80 font-medium">
                  Cursor (.cursor/mcp.json)
                </p>
                <div className="relative bg-bg-app rounded p-3">
                  <pre className="text-xs font-mono text-foreground break-all pr-8 overflow-auto max-h-40">
                    {cursorConfig}
                  </pre>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={cursorConfig} />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-body text-foreground/80 font-medium">
                  Windsurf (~/.codeium/windsurf/mcp_config.json)
                </p>
                <div className="relative bg-bg-app rounded p-3">
                  <pre className="text-xs font-mono text-foreground break-all pr-8 overflow-auto max-h-40">
                    {windsurfConfig}
                  </pre>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={windsurfConfig} />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-body text-foreground/80 font-medium">
                  Claude Desktop (claude_desktop_config.json)
                </p>
                <div className="relative bg-bg-app rounded p-3">
                  <pre className="text-xs font-mono text-foreground break-all pr-8 overflow-auto max-h-40">
                    {claudeDesktopConfig}
                  </pre>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={claudeDesktopConfig} />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-body text-foreground/80 font-medium">
                  VS Code (.vscode/mcp.json)
                </p>
                <div className="relative bg-bg-app rounded p-3">
                  <pre className="text-xs font-mono text-foreground break-all pr-8 overflow-auto max-h-40">
                    {vscodeConfig}
                  </pre>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={vscodeConfig} />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-body text-foreground/80 font-medium">stdio (local)</p>
                <div className="relative bg-bg-app rounded p-3">
                  <code className="text-xs font-mono text-foreground pr-8 block">{stdioCmd}</code>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={stdioCmd} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="gap-1.5 font-body">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('setup.common.back')}
          </Button>
          <Button
            onClick={onNext}
            variant="outline"
            className="flex-1 font-body border-border text-foreground/80"
          >
            {t('setup.mcp.skipForNow')}
          </Button>
          <Button
            onClick={onNext}
            className="flex-1 bg-agent hover:bg-agent/90 text-white font-body gap-2"
          >
            <Rocket className="h-4 w-4" /> {t('setup.mcp.startDeploying')}
          </Button>
        </div>
      </div>
    </div>
  );
}
