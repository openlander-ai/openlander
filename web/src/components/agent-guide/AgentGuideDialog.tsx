/**
 * AgentGuideDialog — v5 central pattern.
 *
 * Replaces the missing wizard for any "+ Add ..." action with a teaching
 * moment: tell the user OpenLander is agent-operated, hand them a prompt
 * to paste into their agent. Two modes branch on MCP connection state:
 *   A) connected   — agent identity strip + active Copy buttons
 *   B) not connected — "First, connect your agent" banner + locked Copies
 *
 * Reused by ProjectView "+ Add service", ServicesPage empty state, and
 * future Domain/Scale entry points. Caller passes `kind` + optional
 * context (`projectName`, `serviceName`) so prompts are pre-filled with
 * the right names.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cable, Check, Copy, Lock, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useLanguage } from '@/i18n/context';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { getAgentGuideContent, type AgentGuideKind } from './prompt-sets';

export interface AgentGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AgentGuideKind;
  projectName?: string;
  serviceName?: string;
  /** Optional env var key (set-env-var / delete-env-var prompts). */
  envVarKey?: string;
  /** Optional domain (remove-domain prompts). */
  domain?: string;
  /** Optional managed-service name (wire-managed-db prompts). */
  managedServiceName?: string;
}

export function AgentGuideDialog({
  open,
  onOpenChange,
  kind,
  projectName,
  serviceName,
  envVarKey,
  domain,
  managedServiceName,
}: AgentGuideDialogProps) {
  const navigate = useNavigate();
  const { status } = useMcpStatus();
  const { t } = useLanguage();
  const sessions = status?.sessions ?? [];
  const connected = sessions.length > 0;
  const lastSession = sessions[0];

  const content = getAgentGuideContent(kind, {
    projectName,
    serviceName,
    envVarKey,
    domain,
    managedServiceName,
  });

  const handleSetupAgent = () => {
    onOpenChange(false);
    navigate('/mcp-server');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-0">
        <header className="flex items-start gap-2 border-b border-[color:var(--ol-border-subtle)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] font-semibold leading-tight text-[color:var(--ol-fg)]">
              {content.heading}
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-[46ch] text-[13px] leading-snug text-[color:var(--ol-fg-muted)]">
              {content.lead}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t('agentGuide.closeDialogLabel')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--ol-fg-subtle)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          {connected ? (
            <AgentIdentityStrip
              // v5.2.1 (CCG / Gemini): the MCP session contract today doesn't
              // expose the connecting client's name (Claude vs Cursor vs
              // Windsurf). Use a generic label until the backend captures
              // clientInfo.name on connect — better-than-wrong.
              agentName={t('agentGuide.agentName')}
              lastActiveLabel={
                lastSession
                  ? formatRelativeTime(lastSession.lastActivityAt, t)
                  : t('common.relative.justNow')
              }
            />
          ) : (
            <ConnectAgentBanner onOpenMcpSetup={handleSetupAgent} />
          )}

          <div className="flex flex-col gap-2" role="list">
            {content.prompts.map((p, i) => (
              <PromptCard key={i} text={p.text} hint={p.hint} disabled={!connected} />
            ))}
          </div>

          {connected && (
            <p className="mt-1 text-[12px] text-[color:var(--ol-fg-muted)]">
              Agent not connected?{' '}
              <button
                type="button"
                onClick={handleSetupAgent}
                className="bg-transparent p-0 text-[color:var(--ol-primary)] hover:underline"
              >
                Set it up →
              </button>
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[color:var(--ol-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
          >
            Close
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function AgentIdentityStrip({
  agentName,
  lastActiveLabel,
}: {
  agentName: string;
  lastActiveLabel: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-lg border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2.5 text-[13px]"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--ol-success)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--ol-success)_24%,transparent)]"
      />
      <span className="flex-1 text-[color:var(--ol-fg)]">
        <b className="font-semibold">{agentName}</b>
        <span className="text-[color:var(--ol-fg-muted)]"> · last active {lastActiveLabel}</span>
      </span>
      <span className="text-[12px] text-[color:var(--ol-fg-muted)]">connected over MCP</span>
    </div>
  );
}

function ConnectAgentBanner({ onOpenMcpSetup }: { onOpenMcpSetup: () => void }) {
  return (
    <div
      role="region"
      aria-label={t('agentGuide.connectAria')}
      className="flex items-start gap-3 rounded-lg border border-[color:var(--ol-warning)]/30 bg-[color:var(--ol-warning-soft)]/40 px-3.5 py-3"
    >
      <div
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[color:var(--ol-warning)]/15 text-[color:var(--ol-warning)]"
      >
        <Cable className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-[color:var(--ol-fg)]">
          First, connect your agent
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-[color:var(--ol-fg-muted)]">
          Point Claude — or any MCP-capable agent — at your OpenLander instance. About a minute.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenMcpSetup}
        className="flex shrink-0 items-center gap-1 rounded-md bg-[color:var(--ol-primary)] px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90"
      >
        Set up agent <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

function PromptCard({ text, hint, disabled }: { text: string; hint?: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLanguage();

  const handleCopy = () => {
    if (disabled) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        // clipboard API unavailable — silently no-op
      });
  };

  return (
    <div
      role="listitem"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] px-3 py-3 pl-3.5 transition-colors',
        disabled ? 'bg-[color:var(--ol-panel-2)]' : 'hover:border-[color:var(--ol-border)]',
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'm-0 break-words font-mono text-[12.5px] leading-relaxed',
            disabled ? 'text-[color:var(--ol-fg-muted)]' : 'text-[color:var(--ol-fg)]',
          )}
        >
          {text}
        </p>
        {hint && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? t('agentGuide.copy.disabledMessage') : t('agentGuide.copy.enabledTitle')}
        className={cn(
          'flex shrink-0 items-center gap-1 self-center rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
          disabled
            ? 'cursor-not-allowed border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]'
            : 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg)] hover:border-[color:var(--ol-border-strong)]',
        )}
      >
        {disabled ? (
          <>
            <Lock className="h-3 w-3" />
            {t('agentGuide.copy.disabledMessage')}
          </>
        ) : copied ? (
          <>
            <Check className="h-3 w-3" />
            {t('agentGuide.copy.success')}
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            {t('agentGuide.copy.label')}
          </>
        )}
      </button>
    </div>
  );
}
