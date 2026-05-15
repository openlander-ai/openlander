/**
 * Your Agent — v0.1 MCP surface.
 *
 * Single page, three cards:
 *
 *   1. Your Agent — Status row + Endpoint row + Token row.
 *      Single org-scoped token. In-page Generate / Reveal-on-issue /
 *      Copy / Regenerate; no modal, no per-token list.
 *
 *   2. Setup — Tabbed MCP client config snippets (Claude Code / Cursor /
 *      Windsurf / Claude Desktop / VS Code / stdio), ready to copy.
 *      Shares `web/src/lib/mcp-config-snippets.ts` with the setup wizard
 *      so both surfaces render the same per-client template.
 *
 *   3. Recent agent calls — compact /api/activity?actor=mcp timeline.
 *      "Full timeline →" link routes to /activity.
 *
 * Token wiring: backed by the v0.1 single-token MCP endpoints (PR #235).
 * `GET /api/mcp/token` returns the keeper or null; `POST /api/mcp/token`
 * is the idempotent "ensure" call (mints if missing, reuses + dedupes
 * if present); `POST /api/mcp/token/regenerate` atomically revokes
 * every active org token and issues a fresh one. The backend owns the
 * single-token invariant so this page no longer needs a list-then-revoke
 * race window. Plain text is only echoed on actual mint/rotate, never
 * on reuse — backend stores hashes, mirroring the spec's "treat like a
 * password" framing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Cable, Check, Copy, Eye, EyeOff, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { useMcpInstance } from '@/hooks/use-mcp-instance';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useLanguage } from '@/i18n/context';
import {
  ensureOrgMcpToken,
  getOrgMcpToken,
  regenerateOrgMcpToken,
  type McpPatTokenMetadata,
} from '@/lib/api';
import {
  buildAgentInstruction,
  buildAllClientConfigs,
  type McpClientId,
} from '@/lib/mcp-config-snippets';
import { formatRelativeTime } from '@/lib/time';
import { copyToClipboard } from '@/lib/utils';

export function MCPServer() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { status: mcpStatus, loading: mcpLoading, error: mcpError } = useMcpStatus();
  const mcpInstance = useMcpInstance();
  const { events: mcpEvents } = useActivityFeed({ limit: 5, actor: 'mcp' });
  const mcpEndpoint = mcpInstance.endpoint;

  const [activeToken, setActiveToken] = useState<McpPatTokenMetadata | null>(null);
  const [tokensLoading, setTokensLoading] = useState(true);
  // Plaintext is only available for the just-issued token — backend
  // does not echo it back on subsequent reads.
  const [newTokenPlain, setNewTokenPlain] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [working, setWorking] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tryPromptCopied, setTryPromptCopied] = useState(false);
  const [instructionCopied, setInstructionCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const [activeClient, setActiveClient] = useState<McpClientId>('claude-code');
  // Track the most recent "Copied!" reset so that copying a second row
  // (or the same row's snippet in a different tab) cancels the prior
  // 1400ms timer instead of letting it race against the new flag. Codex
  // CCG (M1): without this, copying tab A → switching to tab B →
  // copying tab B before A's timeout fires lets A's timeout flip B's
  // Copied state back to false at the wrong moment.
  const copyResetRef = useRef<{ timer: number; setFlag: (v: boolean) => void } | null>(null);

  const tokenSuffix = activeToken ? activeToken.suffix : '';
  const tokenIssuedAt = activeToken ? activeToken.createdAt : null;

  // GET /api/mcp/token applies the v0.1 single-token contract on the
  // server: returns either the keeper row or null. No client-side
  // filter (legacy-default / revoked / expired) is needed any more —
  // PR #235 owns those rules.
  const loadToken = useCallback(async () => {
    setTokensLoading(true);
    try {
      const res = await getOrgMcpToken();
      setActiveToken(res.token);
    } catch {
      toast.error(t('mcpServer.tokens.loadFailed'));
    } finally {
      setTokensLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadToken();
  }, [loadToken]);

  async function handleGenerate() {
    if (working) return;
    setWorking(true);
    setNewTokenPlain(null);
    try {
      // POST /api/mcp/token mints when missing and reuses when present.
      // The Generate button only fires from the empty state, so we
      // expect created=true; if a parallel session minted first, we
      // get plaintext=null and just refresh state without pretending
      // we have a copyable token.
      const issued = await ensureOrgMcpToken({ name: t('mcpServer.tokens.defaultName') });
      setActiveToken(issued.token);
      if (issued.plaintext) {
        setNewTokenPlain(issued.plaintext);
        setRevealed(true);
      }
      // The backend may have rotated a legacy `ol_` API token under our
      // feet (PR #235 cleans them up as part of the single-token
      // contract). Tell the user so a still-running MCP client doesn't
      // mysteriously start failing on the old credential.
      if (issued.legacyTokenRotated) {
        toast.warning(t('mcpServer.tokens.legacyTokenRotated'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('mcpServer.tokens.issueFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function handleRegenerate() {
    if (working) return;
    setWorking(true);
    setNewTokenPlain(null);
    try {
      // POST /api/mcp/token/regenerate atomically revokes every active
      // org token (including legacy-default rows) and issues a fresh
      // one under a server-side lock — no client-side list/revoke
      // race window any more.
      const issued = await regenerateOrgMcpToken({ name: t('mcpServer.tokens.defaultName') });
      setActiveToken(issued.token);
      if (issued.plaintext) {
        setNewTokenPlain(issued.plaintext);
        setRevealed(true);
      }
      toast.success(t('mcpServer.tokens.regenerateSuccess'));
      // See handleGenerate — the rotate path also revokes legacy `ol_`
      // tokens, so warn distinctly from the normal regenerate success.
      if (issued.legacyTokenRotated) {
        toast.warning(t('mcpServer.tokens.legacyTokenRotated'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('mcpServer.tokens.regenerateFailed'));
      // Reload on failure so the UI reflects whatever the backend
      // ended up with.
      await loadToken();
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveInstanceName() {
    try {
      await mcpInstance.save();
      toast.success(t('mcpServer.instance.saved'));
    } catch {
      toast.error(t('mcpServer.instance.saveFailed'));
    }
  }

  async function copy(value: string, setFlag: (v: boolean) => void) {
    try {
      await copyToClipboard(value);
      // Clear the previous "Copied" indicator immediately so only one
      // row shows the success state at a time, and cancel its pending
      // timer so it cannot race against this flag's lifecycle.
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current.timer);
        copyResetRef.current.setFlag(false);
      }
      setFlag(true);
      const timer = window.setTimeout(() => {
        setFlag(false);
        if (copyResetRef.current?.timer === timer) {
          copyResetRef.current = null;
        }
      }, 1400);
      copyResetRef.current = { timer, setFlag };
    } catch {
      /* clipboard rejected — best-effort */
    }
  }

  // Status pip — driven by /api/mcp/status. Successful status fetch +
  // any active session = Connected; otherwise Listening / Unreachable.
  let statusLabel: string;
  let statusColor: string;
  if (mcpError) {
    statusLabel = t('mcpServer.status.unreachable');
    statusColor = 'var(--ol-error)';
  } else if (!mcpStatus) {
    statusLabel = mcpLoading ? t('mcpServer.status.checking') : t('mcpServer.status.unknown');
    statusColor = 'var(--ol-fg-muted)';
  } else if (mcpStatus.totalConnected > 0) {
    statusLabel = t('mcpServer.status.connected');
    statusColor = 'var(--ol-success)';
  } else {
    statusLabel = t('mcpServer.status.listening');
    statusColor = 'var(--ol-fg-muted)';
  }
  const lastSession = mcpStatus?.sessions[0];
  const lastCallLabel = lastSession ? formatRelativeTime(lastSession.lastActivityAt, t) : null;

  // Token display state — what we show on the Token row.
  const tokenDisplay = (() => {
    if (tokensLoading) return null;
    if (!activeToken) return 'none' as const;
    if (newTokenPlain && revealed) return { kind: 'reveal' as const, value: newTokenPlain };
    return { kind: 'masked' as const, value: `mcp_…${tokenSuffix}` };
  })();

  // The Setup snippet embeds the just-issued plaintext only when the
  // token row is also currently revealed. Once the user clicks Hide we
  // redact the snippet too — otherwise "Hide" misleads (the token row
  // would mask while the config block continued to leak the same
  // plaintext to anyone glancing over the shoulder).
  const snippetToken = revealed && newTokenPlain ? newTokenPlain : '<your-token>';
  const clientConfigs = buildAllClientConfigs({
    endpoint: mcpEndpoint,
    token: snippetToken,
    serverName: mcpInstance.serverName,
  });
  const agentInstruction = buildAgentInstruction({ serverName: mcpInstance.serverName });
  const tryPrompt = t('mcpServer.instance.tryPrompt', { name: mcpInstance.serverName });
  const activeConfig = clientConfigs.find((c) => c.id === activeClient) ?? clientConfigs[0];
  // `draftName` is the live input value; `instance.name` is what the
  // server has. Save is enabled only when there is a real, trimmed,
  // *different* value to send — so whitespace-only and empty drafts no
  // longer pay a server roundtrip just to be rejected.
  const draftNameTrimmed = mcpInstance.draftName.trim();
  const instanceDirty = Boolean(
    mcpInstance.instance &&
    draftNameTrimmed.length > 0 &&
    draftNameTrimmed !== mcpInstance.instance.name,
  );
  const canCopyConfigWithToken = Boolean(revealed && newTokenPlain);
  // Three-state label for the disabled Copy button on the Setup card so
  // the hint matches the actual action required:
  //   - no token issued yet → tell the user to Generate
  //   - token issued but client cannot re-display it (returning user)
  //     → only path forward is Regenerate, since Reveal needs a fresh
  //     `newTokenPlain` from this session
  //   - newTokenPlain in memory but currently hidden → Reveal
  const copyDisabledLabel = !activeToken
    ? t('mcpServer.setup.copyNeedsGenerate')
    : !newTokenPlain
      ? t('mcpServer.setup.copyNeedsRegenerate')
      : t('mcpServer.setup.copyNeedsReveal');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[color:var(--ol-primary)]" />
            {t('mcpServer.title')}
          </span>
        }
        subtitle={t('mcpServer.subtitle')}
      >
        <div className="flex flex-col divide-y divide-[color:var(--ol-border-subtle)]">
          {/* Status row */}
          <Row label={t('mcpServer.row.status')}>
            <span
              className="inline-flex items-center gap-1.5 text-[13px] font-medium"
              style={{ color: statusColor }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: statusColor,
                  boxShadow:
                    statusLabel === t('mcpServer.status.connected')
                      ? '0 0 0 3px color-mix(in oklch, var(--ol-success) 30%, transparent)'
                      : 'none',
                }}
              />
              {statusLabel}
            </span>
            {lastCallLabel && (
              <span className="ml-2.5 text-[11.5px] text-[color:var(--ol-fg-muted)]">
                {t('mcpServer.row.lastCall', { when: lastCallLabel })}
              </span>
            )}
          </Row>

          {/* Instance row */}
          <Row label={t('mcpServer.row.instance')}>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={mcpInstance.draftName}
                  disabled={mcpInstance.loading || mcpInstance.saving}
                  onChange={(event) => mcpInstance.setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleSaveInstanceName();
                    }
                  }}
                  className="ol-mono min-w-0 flex-1 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--ol-fg)] outline-none transition-colors focus:border-[color:var(--ol-primary)]"
                  aria-label={t('mcpServer.row.instance')}
                />
                <Button
                  type="button"
                  onClick={() => void handleSaveInstanceName()}
                  disabled={mcpInstance.loading || mcpInstance.saving || !instanceDirty}
                  size="sm"
                  variant="outline"
                >
                  {mcpInstance.saving
                    ? t('mcpServer.instance.saving')
                    : t('mcpServer.instance.save')}
                </Button>
              </div>
              {mcpInstance.error && (
                <p className="text-[11.5px] leading-snug text-[color:var(--ol-error)]">
                  {t('mcpServer.instance.loadFailed')}
                </p>
              )}
              {mcpInstance.instance?.isDefaultName && !mcpInstance.error && (
                <p className="text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
                  {t('mcpServer.instance.defaultWarning')}
                </p>
              )}
            </div>
          </Row>

          {/* Endpoint row */}
          <Row label={t('mcpServer.row.endpoint')}>
            <code className="ol-mono break-all text-[12.5px] text-[color:var(--ol-fg)]">
              {mcpEndpoint}
            </code>
            <button
              type="button"
              onClick={() => void copy(mcpEndpoint, setEndpointCopied)}
              className="ml-2 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
              aria-label={t('mcpServer.row.copyEndpoint')}
            >
              {endpointCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
              {endpointCopied ? t('mcpServer.row.copied') : t('mcpServer.row.copy')}
            </button>
          </Row>

          {/* Agent usage row */}
          <Row label={t('mcpServer.row.tryThis')}>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2">
                <code className="ol-mono min-w-0 break-all text-[12.5px] text-[color:var(--ol-fg)]">
                  {tryPrompt}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(tryPrompt, setTryPromptCopied)}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                >
                  {tryPromptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
                  {tryPromptCopied ? t('mcpServer.row.copied') : t('mcpServer.row.copy')}
                </button>
              </div>
              <p className="text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
                {t('mcpServer.instance.tryHelp')}
              </p>
              <details className="rounded-md border border-dashed border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] p-3">
                <summary className="cursor-pointer text-[12px] font-medium text-[color:var(--ol-fg)]">
                  {t('mcpServer.instance.troubleshootingTitle')}
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
                    {t('mcpServer.instance.troubleshootingHint')}
                  </p>
                  <pre className="ol-mono w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[color:var(--ol-panel-2)] p-3 text-[12px] leading-relaxed text-[color:var(--ol-fg)]">
                    <code>{agentInstruction}</code>
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copy(agentInstruction, setInstructionCopied)}
                    className="inline-flex w-fit shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                  >
                    {instructionCopied ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}{' '}
                    {instructionCopied
                      ? t('mcpServer.row.copied')
                      : t('mcpServer.instance.copyCorrection')}
                  </button>
                </div>
              </details>
            </div>
          </Row>

          {/* Token row */}
          <Row label={t('mcpServer.row.token')}>
            {tokenDisplay == null ? (
              <span className="text-[12px] text-[color:var(--ol-fg-muted)]">
                {t('mcpServer.tokens.loading')}
              </span>
            ) : tokenDisplay === 'none' ? (
              <Button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={working}
                size="sm"
                className="bg-agent text-white hover:bg-agent/90"
              >
                <Plus className="h-3.5 w-3.5" />
                {working ? t('mcpServer.tokens.issuing') : t('mcpServer.tokens.generateAction')}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="ol-mono break-all text-[12.5px] text-[color:var(--ol-fg)]">
                    {tokenDisplay.value}
                  </code>
                  {tokenDisplay.kind === 'reveal' ? (
                    <button
                      type="button"
                      onClick={() => setRevealed(false)}
                      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                    >
                      <EyeOff className="h-3 w-3" /> {t('mcpServer.tokens.hide')}
                    </button>
                  ) : newTokenPlain ? (
                    <button
                      type="button"
                      onClick={() => setRevealed(true)}
                      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                    >
                      <Eye className="h-3 w-3" /> {t('mcpServer.tokens.reveal')}
                    </button>
                  ) : null}
                  {tokenDisplay.kind === 'reveal' && (
                    <button
                      type="button"
                      onClick={() => void copy(tokenDisplay.value, setTokenCopied)}
                      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                    >
                      {tokenCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
                      {tokenCopied ? t('mcpServer.row.copied') : t('mcpServer.row.copy')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRegenerateConfirmOpen(true)}
                    disabled={working}
                    // sm:ml-auto separates the destructive action from
                    // adjacent lightweight Reveal/Hide/Copy buttons on
                    // wider rows so a Regenerate misclick is less likely.
                    // On narrow viewports the row wraps and the margin
                    // collapses naturally.
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-error)] transition-colors hover:bg-[color-mix(in_oklch,var(--ol-error)_9%,transparent)] disabled:cursor-progress disabled:opacity-60 sm:ml-auto"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {working
                      ? t('mcpServer.tokens.regenerating')
                      : t('mcpServer.tokens.regenerateAction')}
                  </button>
                </div>
                <p className="text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
                  {tokenDisplay.kind === 'reveal'
                    ? t('mcpServer.tokens.revealedHint')
                    : t('mcpServer.tokens.passwordHint')}
                  {tokenIssuedAt && (
                    <>
                      {' · '}
                      {t('mcpServer.tokens.issuedAt', {
                        when: formatRelativeTime(tokenIssuedAt, t),
                      })}
                    </>
                  )}
                </p>
              </div>
            )}
          </Row>
        </div>
      </OuterCard>

      {/* Setup card — one tab per supported MCP client, all driven by
          the shared snippet module so this page and the setup wizard
          can't drift. Always mounted: returning users still need the
          client-specific config shape even though the backend cannot
          re-display an existing token. */}
      <OuterCard title={t('mcpServer.setup.title')} subtitle={t('mcpServer.setup.subtitle')}>
        <Tabs
          value={activeConfig.id}
          onValueChange={(v) => {
            setActiveClient(v as McpClientId);
            setConfigCopied(false);
          }}
          className="flex flex-col gap-3"
        >
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-[color:var(--ol-panel-2)] p-1">
            {clientConfigs.map((cfg) => (
              <TabsTrigger key={cfg.id} value={cfg.id} className="text-[12px]">
                {cfg.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {clientConfigs.map((cfg) => (
            <TabsContent key={cfg.id} value={cfg.id} className="m-0 flex flex-col gap-2">
              {cfg.filename && (
                <p className="text-[11.5px] text-[color:var(--ol-fg-muted)]">{cfg.filename}</p>
              )}
              <pre className="ol-mono overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[color:var(--ol-panel-2)] p-3 text-[12px] leading-relaxed text-[color:var(--ol-fg)]">
                <code>{cfg.snippet}</code>
              </pre>
            </TabsContent>
          ))}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
                {canCopyConfigWithToken
                  ? t('mcpServer.setup.restartHint')
                  : t('mcpServer.setup.placeholderHint')}
              </p>
              {!canCopyConfigWithToken && (
                <p className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                  {t('mcpServer.setup.revealToCopyHint')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void copy(activeConfig.snippet, setConfigCopied)}
              disabled={!canCopyConfigWithToken}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {configCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
              {configCopied
                ? t('mcpServer.row.copied')
                : canCopyConfigWithToken
                  ? t('mcpServer.setup.copyConfig')
                  : copyDisabledLabel}
            </button>
          </div>
        </Tabs>
      </OuterCard>

      {/* Recent agent calls */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('mcpServer.recent.title')}
          </span>
        }
        subtitle={t('mcpServer.recent.subtitle')}
        actions={
          <button
            type="button"
            // Link to /activity without a kind filter — the recent panel
            // above filters by `actor: 'mcp'`, but the URL-controlled
            // filter on /activity is `kind`, not `actor`. Routing with
            // `?type=mcp` would show a narrower set (MCP session-state
            // events only) than the recent panel. Sending the user to
            // the unfiltered timeline keeps "Full timeline" honest.
            onClick={() => navigate('/activity')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            {t('mcpServer.recent.fullTimeline')} →
          </button>
        }
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={mcpEvents}
          emptyState={t('mcpServer.recent.empty')}
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>

      <ConfirmDialog
        open={regenerateConfirmOpen}
        onOpenChange={setRegenerateConfirmOpen}
        title={t('mcpServer.tokens.regenerateConfirm.title')}
        description={t('mcpServer.tokens.regenerateConfirm.description')}
        confirmLabel={t('mcpServer.tokens.regenerateConfirm.confirmLabel')}
        variant="destructive"
        onConfirm={() => void handleRegenerate()}
      />
    </div>
  );
}

interface RowProps {
  label: string;
  children: React.ReactNode;
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex flex-col gap-1.5 px-1 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-32 shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)] sm:pt-1">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
    </div>
  );
}

export default MCPServer;
