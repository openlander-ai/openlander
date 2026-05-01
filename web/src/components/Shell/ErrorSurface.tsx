/**
 * ErrorSurface — wires the 16-key ErrorClass registry to a structured
 * failure card. Used by LogViewer's terminal event rendering.
 *
 * Per v4 errors.jsx + Plan Phase C spec.
 */
import { cn } from '@/lib/utils';
import { ERROR_CLASSES, type ErrorClass, type ErrorClassDef } from '@/lib/errorClasses';

/** Blame chip classification */
type BlameCategory = 'your-config' | 'external' | 'our-bug';

const BLAME_MAP: Record<ErrorClass, BlameCategory> = {
  CONFIG_MISSING: 'your-config',
  BUILD_CONTEXT_MISMATCH: 'your-config',
  IMAGE_WRONG_STAGE: 'your-config',
  PORT_CONFLICT: 'your-config',
  CLI_OVERRIDE_SYNTAX: 'your-config',
  DB_EXTENSION_MISSING: 'your-config',
  GIT_ACCESS_DENIED: 'your-config',
  NETWORK_DEPENDENCY_UNREACHABLE: 'external',
  DOCKER_DAEMON_UNREACHABLE: 'external',
  INFRA_UNAVAILABLE: 'external',
  DISK_EXHAUSTED: 'external',
  RUNTIME_CRASH: 'our-bug',
  OOM_KILLED: 'our-bug',
  DEPENDENCY_UNHEALTHY: 'our-bug',
  HEALTHCHECK_TIMEOUT: 'our-bug',
  BUILD_TIMEOUT: 'our-bug',
};

const BLAME_STYLES: Record<BlameCategory, { label: string; className: string }> = {
  'your-config': {
    label: 'your config',
    className:
      'bg-[color-mix(in_oklch,var(--ol-warning)_14%,transparent)] text-[color:var(--ol-warning)]',
  },
  external: {
    label: 'external',
    className: 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
  },
  'our-bug': {
    label: 'our bug',
    className:
      'bg-[color-mix(in_oklch,var(--ol-error)_14%,transparent)] text-[color:var(--ol-error)]',
  },
};

export interface ErrorSurfaceProps {
  /** The 16-key ErrorClass from the deploy terminal event */
  errorClass: ErrorClass;
  /** Optional: override instance-level context (service name, step) */
  target?: string;
  className?: string;
}

export function ErrorSurface({ errorClass, target, className }: ErrorSurfaceProps) {
  const def: ErrorClassDef = ERROR_CLASSES[errorClass] ?? ERROR_CLASSES.RUNTIME_CRASH;
  const blame = BLAME_MAP[errorClass] ?? 'our-bug';
  const blameStyle = BLAME_STYLES[blame];

  const effectiveTarget = target ?? def.target;

  return (
    <div
      className={cn(
        'rounded-[var(--ol-radius)] border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]',
        'flex flex-col gap-3 p-4',
        className,
      )}
      role="alert"
      aria-label={`Deploy error: ${def.title}`}
    >
      {/* Header row: title + blame chip */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold leading-snug text-[color:var(--ol-fg)]">
            {def.title}
          </h3>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]',
            blameStyle.className,
          )}
        >
          {blameStyle.label}
        </span>
      </div>

      {/* Explanation: phase + step + target */}
      <p className="text-[12.5px] leading-snug text-[color:var(--ol-fg-muted)]">
        {def.phase !== '—' && (
          <>
            Failed during <span className="ol-mono text-[color:var(--ol-fg)]">{def.phase}</span>
            {def.step !== '—' && (
              <>
                {' '}
                step <span className="ol-mono text-[color:var(--ol-fg)]">{def.step}</span>
              </>
            )}
            {effectiveTarget && (
              <>
                {' '}
                on <span className="ol-mono text-[color:var(--ol-fg)]">{effectiveTarget}</span>
              </>
            )}
            .
          </>
        )}
        {def.phase === '—' && effectiveTarget && (
          <>
            Target: <span className="ol-mono text-[color:var(--ol-fg)]">{effectiveTarget}</span>.
          </>
        )}
      </p>

      {/* Fix hint */}
      <div className="rounded-md bg-[color:var(--ol-panel-2)] p-3">
        <p className="text-[12.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
          {def.fixHint.replace(/`([^`]+)`/g, '$1')}
        </p>
      </div>

      {/* Code refs */}
      {def.codeRefs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {def.codeRefs.map((ref, i) => (
            <span
              key={i}
              className="ol-mono inline-flex items-center gap-1 rounded border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-2 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)]"
            >
              {ref.path}
              {ref.line != null && (
                <span className="text-[color:var(--ol-fg-subtle)]">:{ref.line}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default ErrorSurface;
