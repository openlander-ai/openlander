/**
 * Web Server settings — Traefik / reverse proxy.
 *
 * Stub for PR3. The real settings page (`/settings?tab=proxy`) already
 * exists; this page will eventually take over that surface. PR3 ships
 * just the chrome so the sidebar link has somewhere to land.
 */
import { Server } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';

export function WebServerSettings() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            Web Server
          </span>
        }
        subtitle="Traefik / reverse proxy configuration."
      >
        <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
          PR3 ships this page as a chrome stub. Wiring against the existing settings state lives in
          the legacy{' '}
          <code className="ol-mono rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5">
            /settings?tab=proxy
          </code>{' '}
          page.
        </p>
        <ul className="mt-3 list-inside list-disc text-[12.5px] text-[color:var(--ol-fg-muted)]">
          <li>HTTPS / Let’s Encrypt</li>
          <li>Default sslip.io domain</li>
          <li>Access log opt-in (per-project)</li>
          <li>Maintenance: image cache prune schedule</li>
        </ul>
      </OuterCard>
    </div>
  );
}

export default WebServerSettings;
