/**
 * McpGuideStep — final step of the setup wizard. Hands the user a working
 * Claude Desktop / Claude Code / Cursor / Windsurf / VS Code config block
 * with their MCP token already substituted.
 *
 * v0.1 PAT migration: previously this step pulled the legacy `ol_` API
 * token from /api/auth/token. The Your Agent page (PR #204) only
 * surfaces real PATs (`olp_`) and filters out the `legacy-default` row,
 * so a wizard-issued legacy token would be invisible-but-valid forever
 * (Codex CCG flagged this as the open risk on PR #205). Switching the
 * wizard to issue an org-scoped PAT closes that gap — the user leaves
 * setup with a token Your Agent can reveal/copy/regenerate.
 *
 * Idempotency: a single `POST /api/mcp/token` (PR #235's
 * `ensureOrgMcpPatToken` wrapper) does the work — the backend mints a
 * fresh token when none exists (returns plaintext) and reuses the
 * keeper when one already does (returns metadata only, no plaintext,
 * and dedupes any straggler PATs). The wizard renders the plaintext
 * into copyable snippets when we have it, and falls back to a
 * "regenerate at Your Agent" notice with the suffix when we don't.
 */
import { useState, useEffect } from 'react';
import { Zap, ChevronDown, ChevronUp, ChevronRight, Rocket, ArrowLeft } from 'lucide-react';
import { ensureOrgMcpToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CopyButton } from './shared';
import { useLanguage } from '@/i18n/context';
import { getMcpEndpoint } from '@/lib/mcp-endpoint';

interface McpGuideStepProps {
  onNext: () => void;
  onBack: () => void;
}

const TOKEN_PLACEHOLDER = 'olp_YOUR_TOKEN';

export function McpGuideStep({ onNext, onBack }: McpGuideStepProps) {
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [existingSuffix, setExistingSuffix] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [legacyRotated, setLegacyRotated] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // POST /api/mcp/token is idempotent: mints when missing,
        // reuses + dedupes when present. plaintext is set only on
        // fresh issuance (`created: true`); on reuse we only have
        // metadata, so the wizard surfaces the suffix and a
        // "regenerate at Your Agent" notice instead of a placeholder
        // pretending to be a real token.
        const issued = await ensureOrgMcpToken({ name: t('setup.mcp.tokenName') });
        if (cancelled) return;
        if (issued.plaintext) {
          setToken(issued.plaintext);
        } else {
          setExistingSuffix(issued.token.suffix);
        }
        // Surface the legacy `ol_` rotation that PR #235 may have done
        // server-side — silently revoking the prior credential during
        // setup would break any still-running MCP client.
        if (issued.legacyTokenRotated) {
          setLegacyRotated(true);
        }
      } catch (err) {
        if (cancelled) return;
        setTokenError(err instanceof Error ? err.message : t('setup.mcp.tokenError'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const mcpUrl = getMcpEndpoint();
  // Render snippets (and the quick-copy block) with the freshly issued
  // plaintext when we have it, and a clean `olp_YOUR_TOKEN` placeholder
  // otherwise. The existing-token / error / loading messages live in
  // dedicated panels above, NOT inline in copyable text — Codex CCG
  // round 1 caught a regression where the quick-copy block embedded
  // status strings inline (suffix-with-status, or an error sentinel),
  // and a careless Copy would land that broken text in the user's
  // MCP config.
  const tokenForSnippet = token ?? TOKEN_PLACEHOLDER;

  const quickCopyText = `Connect the OpenLander MCP server.\nURL: ${mcpUrl}\nToken: ${tokenForSnippet}`;

  const claudeCodeCmd = `claude mcp add openlander --url ${mcpUrl} --header "Authorization: Bearer ${tokenForSnippet}"`;
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        openlander: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${tokenForSnippet}` },
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
          headers: { Authorization: `Bearer ${tokenForSnippet}` },
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
            `Authorization: Bearer ${tokenForSnippet}`,
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
            `Authorization: Bearer ${tokenForSnippet}`,
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

        {/* Token status banner — only shown for the non-fresh paths so a
            fresh first-boot user just sees the copyable config and gets
            on with their day. */}
        {existingSuffix && (
          <div
            data-testid="setup-mcp-existing-token"
            className="rounded-md border border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning-soft,rgba(255,176,0,0.08))] px-4 py-3 text-left text-[12.5px] text-foreground/80"
          >
            {t('setup.mcp.tokenAlreadyIssued', { suffix: existingSuffix })}
          </div>
        )}
        {tokenError && (
          <div
            data-testid="setup-mcp-token-error"
            className="rounded-md border border-[color:var(--ol-error)]/40 bg-[color:var(--ol-error-soft,rgba(239,68,68,0.08))] px-4 py-3 text-left text-[12.5px] text-foreground/80"
          >
            {t('setup.mcp.tokenError')}
          </div>
        )}
        {legacyRotated && (
          <div
            data-testid="setup-mcp-legacy-rotated"
            className="rounded-md border border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning-soft,rgba(255,176,0,0.08))] px-4 py-3 text-left text-[12.5px] text-foreground/80"
          >
            {t('setup.mcp.legacyTokenRotated')}
          </div>
        )}

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
