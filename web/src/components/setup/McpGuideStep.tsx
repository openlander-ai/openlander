import { useState, useEffect } from 'react';
import { Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { getApiToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CopyButton } from './shared';

interface McpGuideStepProps {
  onNext: () => void;
}

export function McpGuideStep({ onNext }: McpGuideStepProps) {
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
          type: 'remote',
          url: mcpUrl,
          headers: { Authorization: `Bearer ${apiToken || 'ol_YOUR_TOKEN'}` },
        },
      },
    },
    null,
    2,
  );
  const stdioCmd = `openlander mcp`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Zap className="h-6 w-6 text-agent" />
        <div>
          <h2 className="font-display text-xl font-bold text-primary-ol">
            Connect AI Coding Tools
          </h2>
          <p className="text-sm font-body text-secondary-ol mt-0.5">
            Let Claude Code, Cursor, or any MCP client deploy for you
          </p>
        </div>
      </div>

      {/* Quick copy block */}
      <div className="space-y-2">
        <p className="text-sm font-body text-secondary-ol">Copy this to your AI coding tool:</p>
        <div className="relative bg-bg-panel border border-border rounded-lg p-4">
          <pre className="text-xs font-mono text-primary-ol whitespace-pre-wrap break-all pr-8">
            {quickCopyText}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={quickCopyText} />
          </div>
        </div>
      </div>

      {/* Collapsible manual setup */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-body text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50 transition-colors"
        >
          <span>▶ Manual setup instructions</span>
          {showManual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showManual && (
          <div className="px-4 pb-4 space-y-4 border-t border-border">
            <div className="space-y-1 pt-3">
              <p className="text-xs font-body text-secondary-ol font-medium">Claude Code</p>
              <div className="relative bg-bg-app rounded p-3">
                <code className="text-xs font-mono text-primary-ol break-all pr-8 block">
                  {claudeCodeCmd}
                </code>
                <div className="absolute top-1.5 right-1.5">
                  <CopyButton text={claudeCodeCmd} />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-body text-secondary-ol font-medium">
                Cursor / Windsurf (.cursor/mcp.json)
              </p>
              <div className="relative bg-bg-app rounded p-3">
                <pre className="text-xs font-mono text-primary-ol break-all pr-8 overflow-auto max-h-40">
                  {cursorConfig}
                </pre>
                <div className="absolute top-1.5 right-1.5">
                  <CopyButton text={cursorConfig} />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-body text-secondary-ol font-medium">stdio (local)</p>
              <div className="relative bg-bg-app rounded p-3">
                <code className="text-xs font-mono text-primary-ol pr-8 block">{stdioCmd}</code>
                <div className="absolute top-1.5 right-1.5">
                  <CopyButton text={stdioCmd} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          onClick={onNext}
          variant="outline"
          className="flex-1 font-body border-border text-secondary-ol"
        >
          Skip for now
        </Button>
        <Button onClick={onNext} className="flex-1 bg-agent hover:bg-agent/90 text-white font-body">
          🚀 Start Deploying
        </Button>
      </div>
    </div>
  );
}
