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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ApprovalsTab } from '@/components/ops/ApprovalsTab';
import { PostmortemsTab } from '@/components/ops/PostmortemsTab';
import { PatternsTab } from '@/components/ops/PatternsTab';
import { UsageTab } from '@/components/ops/UsageTab';
import type { CircuitBreakerState, ActivityItem } from '@/lib/api/operations';
import { PageHeader } from '@/components/layout/PageHeader';

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
    <div className="flex flex-col flex-1 min-h-0 bg-app">
      <PageHeader
        title={t('opsV2.page.title')}
        actions={<KeyboardShortcutsHelp helpButtonRef={helpButtonRef} />}
      />
      <StatusStrip
        healthState={isLoading ? 'unknown' : healthState}
        activeIncidentCount={incidents.length}
        pendingApprovalCount={approvals.length}
        trippedCircuitBreakerCount={trippedCount}
        isAgentActive={isAgentActive}
        connectionStatus={isLoading ? undefined : connectionStatus}
      />

      <div className="flex-1 overflow-auto p-6 xl:p-8">
        <div className="w-full min-w-0 space-y-6">
          {isReconnecting && (
            <div className="flex items-center gap-3 rounded-md bg-warning/10 border border-warning/20 px-4 py-3 text-sm text-warning">
              <Loader2 className="h-4 w-4 animate-spin text-warning" />
              <p>{t('opsV2.errors.retrying').replace('{count}', String(error?.retryCount ?? 1))}</p>
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

          <Tabs value={activeTab} onValueChange={setTab} className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="live">
                <Activity className="h-4 w-4 mr-1.5" />
                {t('ops.live')}
              </TabsTrigger>
              <TabsTrigger value="approvals">
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                {t('ops.approvals')}
              </TabsTrigger>
              <TabsTrigger value="postmortems">
                <FileText className="h-4 w-4 mr-1.5" />
                {t('ops.postmortems')}
              </TabsTrigger>
              <TabsTrigger value="patterns">
                <TrendingUp className="h-4 w-4 mr-1.5" />
                {t('ops.patterns')}
              </TabsTrigger>
              <TabsTrigger value="usage">
                <BarChart3 className="h-4 w-4 mr-1.5" />
                {t('ops.usage')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="live">
              <div className="flex flex-col lg:flex-row gap-6 items-start mb-6">
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

              <main className="min-w-0">
                <MainFeedGrid
                  activities={filteredActivities}
                  isFiltered={activities.length > 0 && filteredActivities.length === 0}
                  onClearFilters={() => setFilters({ ...filters, density: 'all' })}
                  onThreadSelect={handleThreadSelect}
                  focusedIndex={currentFocusIndex}
                  onThreadCountChange={setThreadCount}
                />
              </main>
            </TabsContent>

            <TabsContent value="approvals">
              <ApprovalsTab />
            </TabsContent>

            <TabsContent value="postmortems">
              <PostmortemsTab />
            </TabsContent>

            <TabsContent value="patterns">
              <PatternsTab />
            </TabsContent>

            <TabsContent value="usage">
              <UsageTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <IncidentDetailSlideover
        incidentId={selectedIncidentId}
        onClose={() => setSelectedIncidentId(null)}
      />
    </div>
  );
}
