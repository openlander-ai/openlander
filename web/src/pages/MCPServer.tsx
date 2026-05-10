/**
 * Your Agent — v0.1 MCP surface.
 *
 * Single page, three cards:
 *
 *   1. Your Agent — Status row + Endpoint row + Token row.
 *      Single org-scoped token. In-page Generate / Reveal-on-issue /
 *      Copy / Regenerate; no modal, no per-token list.
 *
 *   2. Setup — Claude Desktop MCP config snippet, ready to copy.
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
import { useCallback, useEffect, useState } from 'react';
import { Bot, Cable, Check, Copy, Eye, EyeOff, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { Button } from '@/components/ui/button';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useLanguage } from '@/i18n/context';
import {
  ensureOrgMcpToken,
  getOrgMcpToken,
  regenerateOrgMcpToken,
  type McpPatTokenMetadata,
} from '@/lib/api';
import { getMcpEndpoint } from '@/lib/mcp-endpoint';

type Translate = (key: string, params?: Record<string, string | number>) => string;

function formatRelative(iso: string, t: Translate): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('mcpServer.relative.justNow');
  if (m < 60) return t('mcpServer.relative.minutes', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('mcpServer.relative.hours', { count: h });
  return t('mcpServer.relative.days', { count: Math.floor(h / 24) });
}

function buildClaudeConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openlander: {
          url: endpoint,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function MCPServer() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { status: mcpStatus, loading: mcpLoading, error: mcpError } = useMcpStatus();
  const { events: mcpEvents } = useActivityFeed({ limit: 5, actor: 'mcp' });
  const mcpEndpoint = getMcpEndpoint();

  const [activeToken, setActiveToken] = useState<McpPatTokenMetadata | null>(null);
  const [tokensLoading, setTokensLoading] = useState(true);
  // Plaintext is only available for the just-issued token — backend
  // does not echo it back on subsequent reads.
  const [newTokenPlain, setNewTokenPlain] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [working, setWorking] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);

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
    if (typeof window !== 'undefined' && !window.confirm(t('mcpServer.tokens.regenerateConfirm'))) {
      return;
    }
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

  async function copy(value: string, setFlag: (v: boolean) => void) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setFlag(true);
      window.setTimeout(() => setFlag(false), 1400);
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
  const lastCallLabel = lastSession ? formatRelative(lastSession.lastActivityAt, t) : null;

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
  const setupSnippet = buildClaudeConfig(mcpEndpoint, snippetToken);

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
                    onClick={() => void handleRegenerate()}
                    disabled={working}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)] disabled:cursor-progress disabled:opacity-60"
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
                        when: formatRelative(tokenIssuedAt, t),
                      })}
                    </>
                  )}
                </p>
              </div>
            )}
          </Row>
        </div>
      </OuterCard>

      {/* Setup card */}
      <OuterCard title={t('mcpServer.setup.title')} subtitle={t('mcpServer.setup.subtitle')}>
        <div className="flex flex-col gap-3">
          <pre className="ol-mono overflow-x-auto rounded-md bg-[color:var(--ol-panel-2)] p-3 text-[12px] leading-relaxed text-[color:var(--ol-fg)]">
            <code>{setupSnippet}</code>
          </pre>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
              {t('mcpServer.setup.restartHint')}
            </p>
            <button
              type="button"
              onClick={() => void copy(setupSnippet, setConfigCopied)}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
            >
              {configCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
              {configCopied ? t('mcpServer.row.copied') : t('mcpServer.setup.copyConfig')}
            </button>
          </div>
        </div>
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
