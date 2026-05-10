/**
 * FailureSummary — registry-driven terminal card.
 *
 * Renders inside the LogViewer's terminal band (a sibling of the
 * scrollable stream, not a child) so the user always sees the verdict
 * regardless of scroll position.
 *
 * The card carries `role="alert" aria-live="assertive"` so screen
 * readers announce it on render. The four actions are stubbed for PR3;
 * the user wires them in PR4 (Copy summary / Copy as Claude prompt /
 * View compose / Re-deploy).
 */
import type { ReactNode } from 'react';
import { AlertOctagon, Code2, Copy, Edit, RefreshCw, Sparkles } from 'lucide-react';
import { getErrorClass, type ErrorClassDef } from '@/lib/errorClasses';

export interface FailureSummaryProps {
  /** Error class id (e.g. `BUILD_CONTEXT_MISMATCH`). */
  errorClass: string;
  /** Optional override — bypasses the registry lookup. */
  override?: ErrorClassDef;
  onCopySummary?: () => void;
  onCopyAsAiPrompt?: () => void;
  onViewCompose?: () => void;
  onRedeploy?: () => void;
}

export function FailureSummary({
  errorClass,
  override,
  onCopySummary,
  onCopyAsAiPrompt,
  onViewCompose,
  onRedeploy,
}: FailureSummaryProps) {
  const def = override ?? getErrorClass(errorClass);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border-l-2 border-[color:var(--ol-error)] bg-[color:var(--ol-error-soft)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[color:var(--ol-error)]">
          <AlertOctagon className="h-3.5 w-3.5" />
          {def.id}
        </span>
        <span className="text-[11px] text-[color:var(--ol-fg-muted)]">
          Phase: <b className="text-[color:var(--ol-fg)]">{def.phase}</b>
          {def.step && def.step !== '—' && <> · step {def.step}</>}
          {def.target && <> · {def.target}</>}
        </span>
      </div>

      <h4 className="mt-2 text-[14px] font-semibold leading-snug text-[color:var(--ol-fg)]">
        {def.title}
      </h4>

      <p className="mt-2 flex items-start gap-2 text-[12.5px] leading-snug text-[color:var(--ol-fg)]">
        <Sparkles
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ol-primary)]"
          aria-hidden
        />
        <span>
          <b className="font-semibold">Likely fix:</b> {renderFixHint(def.fixHint)}
        </span>
      </p>

      {def.codeRefs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {def.codeRefs.map((c, i) => (
            <li
              key={i}
              className="ol-mono flex items-center gap-2 rounded border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] px-2.5 py-1.5 text-[11px]"
            >
              <Code2 className="h-3 w-3 shrink-0 text-[color:var(--ol-fg-muted)]" />
              <span className="font-medium text-[color:var(--ol-fg)]">
                {c.path}
                {c.line != null && `:${c.line}`}
              </span>
              <span className="ml-auto truncate text-[color:var(--ol-fg-muted)]">{c.snippet}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SecondaryAction icon={<Copy className="h-3 w-3" />} onClick={onCopySummary}>
          Copy summary
        </SecondaryAction>
        <SecondaryAction icon={<Sparkles className="h-3 w-3" />} onClick={onCopyAsAiPrompt}>
          Copy as Claude prompt
        </SecondaryAction>
        <SecondaryAction icon={<Edit className="h-3 w-3" />} onClick={onViewCompose}>
          View compose
        </SecondaryAction>
        <PrimaryAction icon={<RefreshCw className="h-3 w-3" />} onClick={onRedeploy}>
          Re-deploy
        </PrimaryAction>
      </div>
    </div>
  );
}

// Render fix-hint with backtick-tokens as <code> spans
function renderFixHint(hint: string): ReactNode[] {
  const parts = hint.split(/(`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code
          key={i}
          className="ol-mono rounded bg-[color:var(--ol-panel-2)] px-1 py-0.5 text-[11.5px]"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function SecondaryAction({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function PrimaryAction({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto inline-flex items-center gap-1 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[11.5px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity hover:opacity-90"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export default FailureSummary;
