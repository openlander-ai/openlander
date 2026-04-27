/**
 * Git Providers settings — GitHub App / PAT / SSH.
 *
 * Stub for PR3. The legacy `/settings?tab=github` page is the real
 * surface today; this PR3 page is the chrome for the new sidebar entry.
 */
import { Code2 } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';

export function GitProvidersSettings() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            Git Providers
          </span>
        }
        subtitle="Connect GitHub for repository access. SSH and PAT supported."
      >
        <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
          PR3 ships this page as a chrome stub. Existing wiring lives in the legacy
          <code className="ol-mono mx-1 rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5">
            /settings?tab=github
          </code>
          page.
        </p>
      </OuterCard>
    </div>
  );
}

export default GitProvidersSettings;
