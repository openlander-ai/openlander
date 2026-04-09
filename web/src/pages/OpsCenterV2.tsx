import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useOpsCenterData } from '@/hooks/use-ops-center-data';
import { StatusStrip } from '@/components/ops/v2/StatusStrip';
import { LeftRail } from '@/components/ops/v2/LeftRail';
import { MainTimeline } from '@/components/ops/v2/MainTimeline';
import { FilterBar, useFilterSearchParams } from '@/components/ops/v2/FilterBar';
import { cn } from '@/lib/utils';
import type { CircuitBreakerState, ActivityItem } from '@/lib/api/operations';

function deriveHealthState(
  incidents: { severity: string }[],
  circuitBreakers: CircuitBreakerState[],
): 'healthy' | 'degraded' | 'critical' | 'unknown' {
  const tripped = circuitBreakers.filter((cb) => cb.state === 'open').length;
  const critical = incidents.filter((i) => i.severity === 'critical').length;
  if (critical > 0 || tripped > 0) return 'critical';
  if (incidents.length > 0) return 'degraded';
  return 'healthy';
}

/** Returns true when viewport width < threshold (in px). SSR-safe. */
function useBreakpoint(maxWidthPx: number): boolean {
  const query = `(max-width: ${maxWidthPx - 1}px)`;
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export function OpsCenterV2() {
  const { t } = useLanguage();
  const {
    activities,
    incidents,
    circuitBreakers,
    approvals,
    isConnected,
    isReconnecting,
    isLoading,
    error,
    retry,
  } = useOpsCenterData();

  // Responsive breakpoints
  const isBelowMd = useBreakpoint(768); // < md: hide rail, show drawer trigger
  const isBelowLg = useBreakpoint(1024); // < lg: force icon-only rail

  // Mobile drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close drawer when resizing past md breakpoint
  useEffect(() => {
    if (!isBelowMd) setDrawerOpen(false);
  }, [isBelowMd]);

  const healthState = deriveHealthState(incidents, circuitBreakers);
  const trippedCount = circuitBreakers.filter((cb) => cb.state === 'open').length;
  const isAgentActive = activities.some(
    (a) => a.type === 'ai:invoked' && a.status === 'ai-running',
  );

  const connectionStatus = isConnected
    ? 'connected'
    : isReconnecting
      ? 'reconnecting'
      : 'disconnected';

  // Filter state (synced with URL search params)
  const [filters, setFilters] = useFilterSearchParams();

  // Derive unique projects for filter dropdown
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of activities) {
      if (a.projectId && !seen.has(a.projectId)) {
        seen.set(a.projectId, a.projectName ?? a.projectId);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [activities]);

  // Apply filters to activities
  const filteredActivities = useMemo(() => {
    let result: ActivityItem[] = activities;
    if (filters.severity) {
      result = result.filter((a) => a.severity === filters.severity);
    }
    if (filters.projectId) {
      result = result.filter((a) => a.projectId === filters.projectId);
    }
    if (filters.density === 'actions-only') {
      result = result.filter((a) => a.status === 'pending' || a.type === 'recovery');
    } else if (filters.density === 'critical-only') {
      result = result.filter((a) => a.severity === 'critical');
    }
    return result;
  }, [activities, filters]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-app">
      <StatusStrip
        healthState={isLoading ? 'unknown' : healthState}
        activeIncidentCount={incidents.length}
        pendingApprovalCount={approvals.length}
        trippedCircuitBreakerCount={trippedCount}
        isAgentActive={isAgentActive}
        connectionStatus={isLoading ? undefined : connectionStatus}
        onMenuClick={isBelowMd ? openDrawer : undefined}
      />

      {/* Error banner */}
      {error && !isLoading && (
        <div
          role="alert"
          className="flex items-center gap-3 px-4 py-2.5 bg-error/10 border-b border-error/20 text-error text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{t('opsV2.error.loadFailed')}</span>
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-error/10 hover:bg-error/20 transition-colors shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            {t('opsV2.error.retry')}
          </button>
        </div>
      )}

      {/* Main body: rail + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left rail — hidden at < md, icon-only at < lg, full at >= lg */}
        <div className="hidden md:flex h-full">
          <LeftRail
            approvals={approvals}
            incidents={incidents}
            circuitBreakers={circuitBreakers}
            forceCollapsed={isBelowLg ? true : undefined}
          />
        </div>

        {/* Mobile drawer overlay — slide-in from left at < md */}
        {isBelowMd && (
          <>
            {/* Backdrop */}
            <div
              aria-hidden="true"
              className={cn(
                'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
                drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
              )}
              onClick={closeDrawer}
            />

            {/* Drawer panel */}
            <div
              role="dialog"
              aria-label={t('opsV2.rail.drawerLabel')}
              aria-modal="true"
              className={cn(
                'fixed inset-y-0 left-0 z-50 flex flex-col',
                'w-[320px] bg-bg-panel shadow-xl',
                'transition-transform duration-200 ease-in-out',
                drawerOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              {/* Drawer close button */}
              <div className="shrink-0 flex items-center justify-end border-b border-[hsl(var(--border))] px-3 py-2">
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label="Close navigation"
                  className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <LeftRail
                approvals={approvals}
                incidents={incidents}
                circuitBreakers={circuitBreakers}
                forceCollapsed={false}
              />
            </div>
          </>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-6">
            {/* Page header */}
            <div>
              <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
                {t('opsV2.page.title')}
              </h1>
              <p className="mt-1 text-sm text-muted-ol font-body">{t('opsV2.page.description')}</p>
              {!isLoading && (
                <span
                  className={
                    isConnected
                      ? 'inline-flex items-center gap-1 text-xs text-success'
                      : 'inline-flex items-center gap-1 text-xs text-muted-ol'
                  }
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-success' : 'bg-muted-ol'}`}
                  />
                  {isConnected
                    ? t('opsV2.connection.connected')
                    : t('opsV2.connection.disconnected')}
                </span>
              )}
            </div>

            {/* Filters */}
            <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />

            {/* Main content — timeline */}
            <main className="min-w-0">
              <MainTimeline activities={filteredActivities} />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
