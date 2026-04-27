/**
 * ProjectsContext — single shared `useProjects()` instance.
 *
 * Before PR7, Sidebar + Home + CommandPalette + ProjectsGrid each
 * mounted their own `useProjects()` instance. With each one polling
 * every 3-10s, the backend saw 3-4× the load it expected from a single
 * client. Worse: each consumer rendered with slightly different state
 * for a frame or two whenever their fetches resolved at different
 * moments.
 *
 * This Provider — mounted once in AppShell — runs ONE `useProjects()`
 * and shares the result. Every consumer reads via
 * `useProjectsContext()` (defined in `hooks/use-projects-context.ts` so
 * Fast Refresh's "components-only" lint stays happy) and gets identical
 * state instantly.
 *
 * Edge cases:
 *   - ProjectsGrid still uses `useProjects(true)` directly when the
 *     "Show archived" toggle is on, because the context only fetches
 *     the default `includeArchived: false` scope. Splitting the
 *     context into two scopes seemed like premature complexity for one
 *     consumer.
 */
import { createContext, type ReactNode } from 'react';
import { useProjects, type UseProjectsReturn } from '@/hooks/use-projects';

// eslint-disable-next-line react-refresh/only-export-components
export const ProjectsContext = createContext<UseProjectsReturn | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const value = useProjects(false);
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
