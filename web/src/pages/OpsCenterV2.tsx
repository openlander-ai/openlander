import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { X, AlertCircle, RefreshCw, Loader2, Activity, Network } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useOpsCenterData } from '@/hooks/use-ops-center-data';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { StatusStrip } from '@/components/ops/v2/StatusStrip';
import { LeftRail } from '@/components/ops/v2/LeftRail';
import { MainFeedGrid } from '@/components/ops/v2/MainFeedGrid';
import { FilterBar, useFilterSearchParams } from '@/components/ops/v2/FilterBar';
import { CircuitBreakerWidget } from '@/components/ops/v2/CircuitBreakerWidget';
import { IncidentDetailSlideover } from '@/components/ops/v2/IncidentDetailSlideover';
import { KeyboardShortcutsHelp } from '@/components/ops/v2/KeyboardShortcutsHelp';
import { cn } from '@/lib/utils';
import type { CircuitBreakerState, ActivityItem } from '@/lib/api/operations';

const DependencyGraph = React.lazy(() => import('../components/ops/v2/DependencyGraph.js'));

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
  // Filter state (synced with URL search params)
  const [filters, setFilters] = useFilterSearchParams();

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
  } = useOpsCenterData(filters.timeRange);

  // Responsive breakpoints
  const isBelowMd = useBreakpoint(768); // < md: hide rail, show drawer trigger
  const isBelowLg = useBreakpoint(1024); // < lg: force icon-only rail

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [viewMode, setViewMode] = useState<'feed' | 'graph'>('feed');

  // Incident slideover state
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Keyboard shortcuts state
  const [currentFocusIndex, setCurrentFocusIndex] = useState(0);

  // Refs for keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handleThreadSelect = useCallback((_correlationId: string, incidentId?: string) => {
    if (incidentId) {
      setSelectedIncidentId(incidentId);
    }
  }, []);

  // Close drawer when resizing past md breakpoint
  useEffect(() => {
    if (!isBelowMd) setDrawerOpen(false);
  }, [isBelowMd]);

  // Keyboard shortcuts
  const [threadCount, setThreadCount] = useState(0);

  const shortcuts = useMemo(
    () => [
      {
        key: 'j',
        handler: () => {
          setCurrentFocusIndex((prev) => Math.min(prev + 1, Math.max(0, threadCount - 1)));
        },
      },
      {
        key: 'k',
        handler: () => {
          setCurrentFocusIndex((prev) => Math.max(prev - 1, 0));
        },
      },
      {
        key: '/',
        handler: () => {
          searchInputRef.current?.focus();
        },
      },
      {
        key: 'Escape',
        handler: () => {
          setSelectedIncidentId(null);
        },
      },
      {
        key: '?',
        handler: () => {
          helpButtonRef.current?.click();
        },
      },
    ],
    [threadCount],
  );

  useKeyboardShortcuts(shortcuts);

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

      {/* Main body: rail + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left rail — hidden at < md, icon-only at < lg, full at >= lg */}
        <div className="hidden md:flex h-full">
          <LeftRail
            approvals={approvals}
            incidents={incidents}
            circuitBreakers={circuitBreakers}
            forceCollapsed={isBelowLg ? true : undefined}
            onIncidentSelect={setSelectedIncidentId}
            searchInputRef={searchInputRef}
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
                  aria-label={t('opsV2.nav.closeNavigation')}
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
                onIncidentSelect={(id) => {
                  setSelectedIncidentId(id);
                  closeDrawer();
                }}
                searchInputRef={searchInputRef}
              />
            </div>
          </>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-6">
            {/* Page header */}
            <div className="flex items-center justify-between">
              <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
                {t('opsV2.page.title')}
              </h1>
              <div className="flex items-center gap-3">
                <KeyboardShortcutsHelp helpButtonRef={helpButtonRef} />
                <div className="flex items-center bg-bg-subtle rounded-lg p-1 border border-[hsl(var(--border))]">
                  <button
                    onClick={() => setViewMode('feed')}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                      viewMode === 'feed'
                        ? 'bg-bg-panel text-primary-ol shadow-sm'
                        : 'text-muted-ol hover:text-secondary-ol',
                    )}
                  >
                    <Activity className="h-4 w-4" />
                    {t('opsV2.graph.feedView')}
                  </button>
                  <button
                    onClick={() => setViewMode('graph')}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                      viewMode === 'graph'
                        ? 'bg-bg-panel text-primary-ol shadow-sm'
                        : 'text-muted-ol hover:text-secondary-ol',
                    )}
                  >
                    <Network className="h-4 w-4" />
                    {t('opsV2.graph.graphView')}
                  </button>
                </div>
              </div>
            </div>

            {/* Error Banners */}
            {isReconnecting && (
              <div className="flex items-center gap-3 rounded-md bg-warning/10 border border-warning/20 px-4 py-3 text-sm text-warning">
                <Loader2 className="h-4 w-4 animate-spin text-warning" />
                <p>
                  {t('opsV2.errors.retrying').replace('{count}', String(error?.retryCount ?? 1))}
                </p>
              </div>
            )}
            {error && !isReconnecting && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-error/10 border border-error/20 px-4 py-3 text-sm text-error">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-4 w-4 text-error" />
                  <p>
                    {error.type === 'connection_lost'
                      ? t('opsV2.errors.connectionLost')
                      : error.type === 'api_error'
                        ? t('opsV2.errors.apiError')
                        : error.message}
                  </p>
                </div>
                <button
                  onClick={retry}
                  className="flex items-center gap-2 rounded bg-bg-panel px-3 py-1.5 text-xs font-medium text-primary-ol hover:bg-bg-subtle border border-[hsl(var(--border))] transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('opsV2.errors.retry')}
                </button>
              </div>
            )}

            {/* Filters */}
            {viewMode === 'feed' && (
              <div className="flex flex-col lg:flex-row gap-6 items-start">
                <div className="flex-1 w-full">
                  <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />
                </div>
                {circuitBreakers.length > 0 && (
                  <div className="w-full lg:w-64 shrink-0 bg-bg-subtle/30 rounded-lg border border-[hsl(var(--border))] p-3">
                    <CircuitBreakerWidget
                      circuitBreakers={circuitBreakers}
                      onFilter={() => setFilters({ ...filters, density: 'actions-only' })}
                      onReset={retry}
                    />
                  </div>
                )}
              </div>
            )}

            <main className="min-w-0">
              {viewMode === 'feed' ? (
                <MainFeedGrid
                  activities={filteredActivities}
                  isFiltered={activities.length > 0 && filteredActivities.length === 0}
                  onClearFilters={() => setFilters({ ...filters, density: 'all' })}
                  onThreadSelect={handleThreadSelect}
                  focusedIndex={currentFocusIndex}
                  onThreadCountChange={setThreadCount}
                />
              ) : (
                <div className="h-[600px] w-full">
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))]">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-ol" />
                      </div>
                    }
                  >
                    <DependencyGraph />
                  </Suspense>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>

      <IncidentDetailSlideover
        incidentId={selectedIncidentId}
        onClose={() => setSelectedIncidentId(null)}
      />
    </div>
  );
}
