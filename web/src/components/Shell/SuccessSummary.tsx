/**
 * SuccessSummary — terminal card shown when a deploy ends cleanly.
 *
 * Displayed as a sibling of the LogViewer scroll area (in the terminal
 * band) so it can never render off-screen.
 *
 * Surfaces the public URL (clickable / copyable / open-in-new-tab) and
 * the internal hostname for inter-container calls.
 */
import { CheckCircle, Copy, ExternalLink, Globe } from 'lucide-react';

export interface SuccessSummaryProps {
  /** Service name shown in the URL row */
  serviceName: string;
  /** Public URL (sslip.io or custom domain) */
  publicUrl?: string | null;
  /** Internal port used for inter-container calls (`http://ol-{name}:{port}`) */
  internalPort?: number | null;
  /** Display string for build duration, e.g. "2m 48s" */
  duration?: string;
  onCopyUrl?: () => void;
  onOpenUrl?: () => void;
}

export function SuccessSummary({
  serviceName,
  publicUrl,
  internalPort,
  duration,
  onCopyUrl,
  onOpenUrl,
}: SuccessSummaryProps) {
  // No silent fallback URL: rendering `https://{name}.{sslip}.sslip.io`
  // as the live URL was leaking the literal `{sslip}` template through
  // to users whenever the caller did not plumb `publicUrl`. If the
  // public URL is not known, omit the row entirely; same policy for
  // `internalPort` so we never render `:—` as a port suffix. The card
  // still says "Deploy succeeded · 2m 48s" so the user sees the
  // success signal, just without lies about the address.
  const hasUrl = Boolean(publicUrl);
  const hasInternal = typeof internalPort === 'number' && internalPort > 0;
  return (
    <div
      role="status"
      className="rounded-md border-l-2 border-[color:var(--ol-success)] bg-[color:var(--ol-success-soft)] p-4"
    >
      <h4 className="flex items-center gap-2 text-[13.5px] font-semibold text-[color:var(--ol-fg)]">
        <CheckCircle className="h-4 w-4 text-[color:var(--ol-success)]" />
        Deploy succeeded
        {duration && (
          <span className="ol-mono text-[11.5px] font-normal text-[color:var(--ol-fg-muted)]">
            · {duration}
          </span>
        )}
      </h4>

      {(hasUrl || hasInternal) && (
        <div className="mt-3">
          {hasUrl && (
            <>
              <div className="text-[11px] text-[color:var(--ol-fg-muted)]">
                Your app is live at:
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-[color:var(--ol-primary)]" />
                <a
                  href={publicUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="ol-mono break-all text-[12.5px] text-[color:var(--ol-primary)] hover:underline"
                >
                  {publicUrl}
                </a>
                <button
                  type="button"
                  onClick={onCopyUrl}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                  aria-label="Copy URL"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={onOpenUrl}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                  aria-label="Open in new tab"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
          {hasInternal && (
            <div className="ol-mono mt-1 text-[11px] text-[color:var(--ol-fg-muted)]">
              Internal:{' '}
              <span className="text-[color:var(--ol-fg-subtle)]">
                http://ol-{serviceName}:{internalPort}
              </span>{' '}
              <span className="text-[color:var(--ol-fg-subtle)]">(for inter-container calls)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SuccessSummary;
