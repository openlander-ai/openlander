/**
 * SSH Keys settings.
 *
 * Stub for PR3. The legacy `/settings?tab=security` page is the
 * substantive surface today; this page is the chrome for the new
 * sidebar entry.
 */
import { Key } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';

export function SSHKeysSettings() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Key className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            SSH Keys
          </span>
        }
        subtitle="Repo access keys. Used for cloning private repositories."
      >
        <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
          PR3 ships this page as a chrome stub. Existing wiring lives in the legacy
          <code className="ol-mono mx-1 rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5">
            /settings?tab=security
          </code>
          page.
        </p>
      </OuterCard>
    </div>
  );
}

export default SSHKeysSettings;
