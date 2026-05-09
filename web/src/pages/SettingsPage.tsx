/**
 * v0.1 Settings host — narrowed to a GitHub connect/re-auth handoff.
 *
 * The legacy 3-tab page (system / proxy / github) was retired:
 *   - system: Global Secrets UI was cut for v0.1 (backend remains).
 *   - proxy:  Replaced by the dedicated `/settings/web-server` surface.
 *   - github: KEPT — the device-flow + token-paste UI in
 *             `GithubSettingsTab` is still the destination of the
 *             `Re-authorize` and `Connect GitHub` CTAs on the
 *             `/settings/git-providers` page (GitProviders.tsx
 *             window.location.assign('/settings?tab=github')). Until
 *             that handoff is inlined into GitProviders directly, the
 *             route lives on as a single-tab GitHub-only host so the
 *             live CTAs do not dead-end on the catch-all redirect.
 *
 * Stale `?tab=system` / `?tab=proxy` / `?tab=security` / `?tab=mcp`
 * query parameters are silently ignored — no tab switcher is rendered.
 */
import { Loader2 } from 'lucide-react';
import { useSetup } from '@/hooks/use-setup';
import { GithubSettingsTab } from '@/components/settings/GithubSettingsTab';

export function SettingsPage() {
  const { status, loading, refetch } = useSetup();

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 min-w-0 overflow-auto p-6 xl:p-8">
        <GithubSettingsTab status={status} refetch={refetch} />
      </div>
    </div>
  );
}
