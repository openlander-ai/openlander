/**
 * useProjectsContext — read the AppShell-mounted shared `useProjects()`
 * instance. Pulled out of `projects-context.tsx` so React Fast Refresh
 * (which insists "components-only" exports) doesn't choke on a mixed
 * file.
 *
 * 1.0-rc.2 (data-model fullsplit) note: this hook returns groups (the
 * historic `Project` row, now reframed as the group/container). During
 * the additive-schema transition the wire shape still includes
 * deployable-only fields (`status`, `assignedPort`, `containerId`)
 * because P1 keeps both old + new columns coexisting on responses, so
 * existing consumers keep rendering without a breaking rewire.
 *
 * **For deployable detail per group, prefer `useGroupServices(groupId)`.**
 * After 1.0, deployable fields will be dropped from the projects/groups
 * response and consumers reading them off this hook will need to migrate.
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
