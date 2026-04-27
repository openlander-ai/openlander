/**
 * Viewport hook — observes a single MediaQueryList and reports its
 * match state. Used by AppShell + ProjectViewV2 + InfraMap to drive
 * mobile-responsive behavior (auto-collapsed sidebar, dense topology
 * layout) without re-rolling matchMedia logic in three places.
 *
 * Sized to React 19's effect-discipline rules: we read the initial
 * value during render via a useState initializer so the FIRST paint is
 * already correct. The effect afterwards only subscribes to changes —
 * it never `setState` synchronously inside.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * `true` when viewport width is below Tailwind's `md` breakpoint
 * (768px). The whole point: collapse the sidebar to icon-only and
 * force the InfraMap dense layout in this band.
 */
export function useIsBelowMd(): boolean {
  return useMediaQuery('(max-width: 767.98px)');
}
