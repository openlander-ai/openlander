import { useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  RefreshCw,
  Loader2,
  Activity,
  ShieldCheck,
  FileText,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useOpsCenterData } from '@/hooks/use-ops-center-data';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { StatusStrip } from '@/components/ops/v2/StatusStrip';
import { MainFeedGrid } from '@/components/ops/v2/MainFeedGrid';
import { FilterBar, useFilterSearchParams } from '@/components/ops/v2/FilterBar';
import { CircuitBreakerWidget } from '@/components/ops/v2/CircuitBreakerWidget';
import { IncidentDetailSlideover } from '@/components/ops/v2/IncidentDetailSlideover';
import { KeyboardShortcutsHelp } from '@/components/ops/v2/KeyboardShortcutsHelp';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApprovalsTab } from '@/components/ops/ApprovalsTab';
import { PostmortemsTab } from '@/components/ops/PostmortemsTab';
import { PatternsTab } from '@/components/ops/PatternsTab';
import { UsageTab } from '@/components/ops/UsageTab';
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

const triggerClass =
  'flex items-center gap-2 w-full !justify-start text-left px-3 py-2 rounded-md text-xs font-body transition-colors shadow-none data-[state=active]:shadow-none data-[state=active]:bg-bg-subtle data-[state=active]:text-foreground data-[state=active]:font-medium text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50 whitespace-nowrap';

export function OpsCenterV2() {
  const { t } = useLanguage();
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

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'live';
  const setTab = (tab: string) => setSearchParams({ tab });

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [currentFocusIndex, setCurrentFocusIndex] = useState(0);
  const [threadCount, setThreadCount] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const handleThreadSelect = useCallback((_correlationId: string, incidentId?: string) => {
    if (incidentId) {
      setSelectedIncidentId(incidentId);
    }
  }, []);

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

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of activities) {
      if (a.projectId && !seen.has(a.projectId)) {
        seen.set(a.projectId, a.projectName ?? a.projectId);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [activities]);

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
    <div className="flex flex-col h-full w-full">
      <KeyboardShortcutsHelp helpButtonRef={helpButtonRef} />
      <StatusStrip
        healthState={isLoading ? 'unknown' : healthState}
        activeIncidentCount={incidents.length}
        pendingApprovalCount={approvals.length}
        trippedCircuitBreakerCount={trippedCount}
        isAgentActive={isAgentActive}
        connectionStatus={isLoading ? undefined : connectionStatus}
      />

      {circuitBreakers.length > 0 && (
        <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-subtle/30 px-6 xl:px-8 py-3">
          <CircuitBreakerWidget
            circuitBreakers={circuitBreakers}
            onFilter={() => {
              setTab('live');
              setFilters({ ...filters, density: 'actions-only' });
            }}
            onReset={retry}
          />
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={setTab}
        className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden"
      >
        {/* Sub-sidebar (matches SettingsPage / ProjectDetail → Settings nav) */}
        <TabsList className="flex flex-row md:flex-col h-auto md:h-full w-full md:w-48 bg-bg-panel p-3 gap-1 justify-start md:items-stretch shrink-0 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
          <TabsTrigger value="live" className={triggerClass}>
            <Activity className="h-4 w-4 shrink-0" />
            {t('ops.live')}
          </TabsTrigger>
          <TabsTrigger value="approvals" className={triggerClass}>
            <ShieldCheck className="h-4 w-4 shrink-0" />
            {t('ops.approvals')}
          </TabsTrigger>
          <TabsTrigger value="postmortems" className={triggerClass}>
            <FileText className="h-4 w-4 shrink-0" />
            {t('ops.postmortems')}
          </TabsTrigger>
          <TabsTrigger value="patterns" className={triggerClass}>
            <TrendingUp className="h-4 w-4 shrink-0" />
            {t('ops.patterns')}
          </TabsTrigger>
          <TabsTrigger value="usage" className={triggerClass}>
            <BarChart3 className="h-4 w-4 shrink-0" />
            {t('ops.usage')}
          </TabsTrigger>
        </TabsList>

        {/* Main content area */}
        <div className="flex-1 min-w-0 overflow-auto p-6 xl:p-8">
          <div className="w-full min-w-0 space-y-6">
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
                  className="flex items-center gap-2 rounded bg-bg-panel px-3 py-1.5 text-xs font-medium text-foreground hover:bg-bg-subtle border border-[hsl(var(--border))] transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('opsV2.errors.retry')}
                </button>
              </div>
            )}

            <TabsContent
              value="live"
              className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
            >
              <div className="mb-6">
                <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />
              </div>

              <MainFeedGrid
                activities={filteredActivities}
                isFiltered={activities.length > 0 && filteredActivities.length === 0}
                onClearFilters={() => setFilters({ ...filters, density: 'all' })}
                onThreadSelect={handleThreadSelect}
                focusedIndex={currentFocusIndex}
                onThreadCountChange={setThreadCount}
              />
            </TabsContent>

            <TabsContent
              value="approvals"
              className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
            >
              <ApprovalsTab />
            </TabsContent>

            <TabsContent
              value="postmortems"
              className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
            >
              <PostmortemsTab />
            </TabsContent>

            <TabsContent
              value="patterns"
              className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
            >
              <PatternsTab />
            </TabsContent>

            <TabsContent
              value="usage"
              className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
            >
              <UsageTab />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <IncidentDetailSlideover
        incidentId={selectedIncidentId}
        onClose={() => setSelectedIncidentId(null)}
      />
    </div>
  );
}
