/**
 * McpGuideStep — final step of the setup wizard. Hands the user a working
 * Codex / Claude Desktop / Claude Code / Cursor / Windsurf / VS Code config block
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
 * Onboarding R3 (2026-05-13): the wizard no longer auto-issues the
 * token on mount. Previously `Skip for now` would still leave a freshly
 * minted PAT in the database — confusing for the user who clicks Skip
 * expecting NOT to be enrolled. Now mount does a metadata GET only;
 * issuance happens behind an explicit "Generate token" CTA. Existing
 * tokens (returning user) surface via the same suffix banner as before.
 *
 * Token issuance contract:
 *   - GET /api/mcp/token — metadata only, never plaintext.
 *   - POST /api/mcp/token — `ensureOrgMcpPatToken`: mint when missing
 *     (returns plaintext), reuse + dedupe when present (metadata only).
 */
import { useState, useEffect } from 'react';
import {
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Rocket,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { ensureOrgMcpToken, getOrgMcpToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CopyButton } from './shared';
import { useLanguage } from '@/i18n/context';
import { buildAllClientConfigs } from '@/lib/mcp-config-snippets';
import { useMcpInstance } from '@/hooks/use-mcp-instance';
import { localizeApiError } from '@/lib/localized-api-error';

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const mcpInstance = useMcpInstance();

  // Mount-time probe — metadata only, never the plaintext. The user
  // gets the snippet block only after they explicitly click Generate
  // (or, for returning users, the existing-token banner makes it clear
  // why no copyable snippet appears — they should regenerate from
  // Your Agent rather than re-mint here).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { token: existing } = await getOrgMcpToken();
        if (cancelled) return;
        if (existing) {
          setExistingSuffix(existing.suffix);
        }
      } catch (err) {
        if (cancelled) return;
        setTokenError(localizeApiError(err, t, 'setup.mcp.tokenError', 'common.errors.codes'));
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setTokenError(null);
    try {
      // ensureOrgMcpToken is idempotent: mint when missing (plaintext
      // set), reuse + dedupe when present (plaintext null). The
      // wizard surfaces plaintext only on actual mint, never a
      // placeholder pretending to be a real token.
      const issued = await ensureOrgMcpToken({ name: t('setup.mcp.tokenName') });
      if (issued.plaintext) {
        setToken(issued.plaintext);
        // Returning-user banner is no longer meaningful once we have
        // a fresh plaintext — clear it so the UI is unambiguous.
        setExistingSuffix(null);
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
      setTokenError(localizeApiError(err, t, 'setup.mcp.tokenError', 'common.errors.codes'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveInstanceName = async () => {
    try {
      await mcpInstance.save();
    } catch {
      setTokenError(t('setup.mcp.instanceSaveFailed'));
    }
  };

  const mcpUrl = mcpInstance.endpoint;
  // Render snippets (and the quick-copy block) with the freshly issued
  // plaintext when we have it, and a clean `olp_YOUR_TOKEN` placeholder
  // otherwise. The existing-token / error / loading messages live in
  // dedicated panels above, NOT inline in copyable text — Codex CCG
  // round 1 caught a regression where the quick-copy block embedded
  // status strings inline (suffix-with-status, or an error sentinel),
  // and a careless Copy would land that broken text in the user's
  // MCP config.
  const tokenForSnippet = token ?? TOKEN_PLACEHOLDER;

  const quickCopyText = `Connect the OpenLander MCP server.\nName: ${mcpInstance.serverName}\nURL: ${mcpUrl}\nToken: ${tokenForSnippet}`;

  const clientConfigs = buildAllClientConfigs({
    endpoint: mcpUrl,
    token: tokenForSnippet,
    serverName: mcpInstance.serverName,
  });
  const tryPrompt = t('setup.mcp.tryPrompt', { name: mcpInstance.serverName });

  // Hide the copy/manual surface unless we actually have plaintext to
  // hand the user. Showing the `olp_YOUR_TOKEN` placeholder dressed up
  // as a copyable value is worse than no block at all — they'd happily
  // Copy that garbage into their MCP config.
  //
  // Gemini CCG R3 follow-up: the returning-user (existingSuffix only)
  // path used to flip the surface on too, leaving the user with a
  // banner saying "regenerate at Your Agent" AND a Copy block holding
  // a placeholder. That looked like a Generate failure rather than
  // intended behaviour. Now the surface is plaintext-gated; the
  // banner alone owns the returning-user explanation.
  const showSnippetSurface = token !== null;

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
            {tokenError}
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

        <div className="rounded-lg border border-border bg-bg-panel/50 px-4 py-4 text-left space-y-2">
          <label className="text-xs font-body font-semibold uppercase tracking-[0.08em] text-foreground/60">
            {t('setup.mcp.instanceName')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={mcpInstance.draftName}
              disabled={mcpInstance.loading || mcpInstance.saving}
              onChange={(event) => mcpInstance.setDraftName(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-bg-app px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-agent"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSaveInstanceName()}
              disabled={mcpInstance.loading || mcpInstance.saving}
              className="font-body"
            >
              {mcpInstance.saving ? t('setup.mcp.savingInstance') : t('setup.mcp.saveInstance')}
            </Button>
          </div>
          <p className="text-xs font-body text-foreground/60">
            {mcpInstance.instance?.isDefaultName
              ? t('setup.mcp.instanceDefaultWarning')
              : t('setup.mcp.instanceHelp')}
          </p>
          <div className="rounded-md bg-bg-app p-3">
            <p className="text-xs font-body text-foreground/60">{t('setup.mcp.tryAfterConnect')}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="min-w-0 break-all text-xs font-mono text-foreground">
                {tryPrompt}
              </code>
              <CopyButton text={tryPrompt} />
            </div>
          </div>
        </div>

        {/* R3 (2026-05-13): explicit Generate CTA for new users. Until
            this is clicked we don't POST to /api/mcp/token — the
            previous auto-issue behaviour silently enrolled users who
            clicked Skip. */}
        {!showSnippetSurface && (
          <div
            data-testid="setup-mcp-generate-cta"
            className="rounded-lg border border-dashed border-border bg-bg-panel/50 px-4 py-6 text-left space-y-3"
          >
            <p className="text-sm font-body text-foreground/80">{t('setup.mcp.noTokenYet')}</p>
            <Button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || isFetching}
              className="bg-agent hover:bg-agent/90 text-white font-body gap-2"
            >
              {isGenerating || isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {isGenerating ? t('setup.mcp.generating') : t('setup.mcp.generateToken')}
            </Button>
          </div>
        )}

        {/* Quick copy block — only rendered once a real token (fresh or
            existing) is in play, so the user never sees the
            `olp_YOUR_TOKEN` placeholder dressed up as a copyable
            value. */}
        {showSnippetSurface && (
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
        )}

        {/* Collapsible manual setup — same visibility rules as the
            quick copy block above. */}
        {showSnippetSurface && (
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
                {clientConfigs.map((cfg, idx) => (
                  <div key={cfg.id} className={`space-y-1 ${idx === 0 ? 'pt-3' : ''}`}>
                    <p className="text-xs font-body text-foreground/80 font-medium">
                      {cfg.label}
                      {cfg.filename ? ` (${cfg.filename})` : ''}
                    </p>
                    <div className="relative bg-bg-app rounded p-3">
                      <pre className="text-xs font-mono text-foreground break-all pr-8 overflow-auto max-h-40 whitespace-pre-wrap">
                        {cfg.snippet}
                      </pre>
                      <div className="absolute top-1.5 right-1.5">
                        <CopyButton text={cfg.snippet} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
