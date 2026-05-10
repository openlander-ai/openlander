/**
 * SSH Keys settings.
 *
 * Deferred to v0.2 (out-of-scope: "SSH Keys,
 * Notifications pages"). The route stays mounted at /settings/ssh-keys
 * so a direct link does not 404, but the page is intentionally a stub
 * — the v0.1 sidebar exposes only Git Providers under Settings, so the
 * only way to reach this surface is by typing the URL directly.
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
          SSH Keys management lands in v0.2. The page is reserved here so the route stays available;
          until then, GitHub OAuth (Settings → Git Providers) is the v0.1 path for private-repo
          access.
        </p>
      </OuterCard>
    </div>
  );
}

export default SSHKeysSettings;
