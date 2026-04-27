/**
 * useProjectsContext — read the AppShell-mounted shared `useProjects()`
 * instance. Pulled out of `projects-context.tsx` so React Fast Refresh
 * (which insists "components-only" exports) doesn't choke on a mixed
 * file.
 */
import { useContext } from 'react';
import { ProjectsContext } from '@/contexts/projects-context';
import type { UseProjectsReturn } from '@/hooks/use-projects';

export function useProjectsContext(): UseProjectsReturn {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error(
      'useProjectsContext must be used within a <ProjectsProvider>. ' +
        'Mount it in AppShell so Sidebar/Home/CommandPalette can share a ' +
        'single poller.',
    );
  }
  return ctx;
}
