import { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare,
  AlertCircle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import { humanizeEventType, relativeTime } from '../utils.js';
import { SeverityBadge } from '../SeverityBadge.js';
import { resetCircuitBreaker, fetchOpsIncidents } from '../../../lib/api/operations.js';
import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
import type { ActionRun } from '../../../lib/api/projects.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

const STORAGE_KEY = 'ops-v2-rail-collapsed';

export interface LeftRailProps {
  approvals: ActionRun[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  onFilterChange?: (filter: { type?: string; severity?: string }) => void;
  onIncidentSelect?: (incidentId: string) => void;
  /** When true, forces icon-only collapsed mode regardless of local state */
  forceCollapsed?: boolean;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}

function SectionHeader({ icon, label, count, collapsed, active, onClick }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150',
        'hover:bg-bg-subtle',
        active ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
        collapsed ? 'justify-center' : 'justify-start',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-xs font-semibold truncate">{label}</span>
          {count > 0 && (
            <span className="text-xs font-mono bg-bg-subtle border border-[hsl(var(--border))] px-1.5 py-0.5 rounded-full shrink-0">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function IncidentRow({
  incident,
  count,
  lastEventTime,
  collapsed,
  onClick,
}: {
  incident: OpsIncident;
  count: number;
  lastEventTime: number;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const { t, language } = useLanguage();
  const severityColor =
    incident.severity === 'critical'
      ? 'bg-error'
      : incident.severity === 'warning'
        ? 'bg-warning'
        : 'bg-muted-ol';

  const displayTitle = incident.triggerType
    ? humanizeEventType(incident.triggerType, t)
    : incident.title;

  const titleWithCount =
    count > 1
      ? t('opsV2.rail.incidentCount', { title: displayTitle, count: String(count) })
      : displayTitle;
  const projectName = incident.projectName || incident.project_id;
  const timeStr = relativeTime(lastEventTime, language as 'ko' | 'en');

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex justify-center py-1 w-full hover:bg-bg-subtle rounded-md transition-colors"
        title={`${projectName}: ${titleWithCount}`}
      >
        <div
          className={cn(
            'relative flex items-center justify-center h-6 w-6 rounded-md shrink-0 border',
            incident.severity === 'critical'
              ? 'border-error text-error bg-error/10'
              : incident.severity === 'warning'
                ? 'border-warning text-warning bg-warning/10'
                : 'border-muted-ol text-muted-ol bg-muted-ol/10',
          )}
        >
          <span className="text-[10px] font-bold">{projectName.charAt(0).toUpperCase()}</span>
          <span className={cn('absolute -top-1 -right-1 h-2 w-2 rounded-full', severityColor)} />
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 px-2 py-2 rounded-md transition-colors w-full text-left',
        incident.severity === 'critical' ? 'bg-error/5 hover:bg-error/10' : 'hover:bg-bg-subtle',
      )}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2 w-2 rounded-full shrink-0', severityColor)} />
          <SeverityBadge severity={incident.severity} />
          <span className="text-xs font-semibold text-primary-ol truncate">{projectName}</span>
        </div>
        <span className="text-[10px] text-muted-ol shrink-0 ml-2">{timeStr}</span>
      </div>
      <div className="pl-4 mt-0.5 w-full">
        <span className="text-xs font-body text-secondary-ol truncate block">{titleWithCount}</span>
      </div>
    </button>
  );
}

function ApprovalRow({ approval, collapsed }: { approval: ActionRun; collapsed: boolean }) {
  const { t } = useLanguage();
  const strategy = approval.recovery_strategy
    ? t(`ops.recoveryStrategy.${approval.recovery_strategy}`)
    : t('ops.recoveryStrategy.unknown');
  const label = `${t('opsV2.rail.actionRequired')}: ${strategy}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className="h-2 w-2 rounded-full shrink-0 bg-warning" title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className="h-2 w-2 rounded-full shrink-0 mt-1 bg-warning" />
      <span className="text-xs font-body text-primary-ol truncate" title={label}>
        {label}
      </span>
    </div>
  );
}

function CircuitBreakerRow({
  breaker,
  index,
  collapsed,
}: {
  breaker: CircuitBreakerWithProject;
  index: number;
  collapsed: boolean;
}) {
  const { t } = useLanguage();
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isOpen = breaker.state === 'open';
  const isHalfOpen = breaker.state === 'half_open';
  const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
  const displayName = breaker.projectName || `CB #${index + 1}`;
  const label = `${displayName}: ${breaker.state}`;

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetCircuitBreaker(breaker.projectId);
      toast.success(t('opsV2.widgets.circuitBreakers.resetSuccess'));
      setShowConfirm(false);
    } catch {
      toast.error(t('opsV2.widgets.circuitBreakers.resetError'));
    } finally {
      setIsResetting(false);
    }
  };

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} title={label} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors group">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
          <span className="text-xs font-body text-primary-ol truncate">{label}</span>
        </div>
        {isOpen && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-bg-panel rounded text-muted-ol hover:text-primary-ol"
            title={t('opsV2.widgets.circuitBreakers.reset')}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('opsV2.widgets.circuitBreakers.resetConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('opsV2.widgets.circuitBreakers.resetConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(false)}
              disabled={isResetting}
            >
              {t('opsV2.approvals.confirmCancel')}
            </Button>
            <Button size="sm" onClick={() => void handleReset()} disabled={isResetting}>
              {isResetting ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : null}
              {t('opsV2.widgets.circuitBreakers.reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeftRail({
  approvals,
  incidents,
  circuitBreakers,
  onFilterChange,
  onIncidentSelect,
  forceCollapsed,
}: LeftRailProps) {
  const { t } = useLanguage();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // forceCollapsed overrides local state (used for < lg breakpoint)
  const effectivelyCollapsed = forceCollapsed ?? collapsed;

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchResults, setSearchResults] = useState<OpsIncident[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedSearch) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    let isMounted = true;
    setIsSearching(true);

    fetchOpsIncidents(undefined, 'open', debouncedSearch)
      .then((data) => {
        if (isMounted) {
          setSearchResults(data.incidents);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSearching(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [debouncedSearch]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Sync localStorage changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) {
        setCollapsed(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleSectionClick = useCallback(
    (type: string) => {
      const next = activeFilter === type ? null : type;
      setActiveFilter(next);
      onFilterChange?.(next ? { type: next } : {});
    },
    [activeFilter, onFilterChange],
  );

  const approvalItems = approvals;
  const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');

  const displayIncidents = searchResults !== null ? searchResults : incidents;

  // Group incidents by project + humanized trigger type (or title) to deduplicate
  const groupedIncidents = displayIncidents.reduce<
    Array<{ incident: OpsIncident; count: number; groupKey: string; lastEventTime: number }>
  >((acc, incident) => {
    const key = `${incident.project_id}::${incident.triggerType ?? incident.title}`;
    const existing = acc.find((g) => g.groupKey === key);
    const time =
      typeof incident.created_at === 'string'
        ? new Date(incident.created_at).getTime()
        : incident.created_at;
    if (existing) {
      existing.count += 1;
      if (time > existing.lastEventTime) {
        existing.lastEventTime = time;
      }
    } else {
      acc.push({ incident, count: 1, groupKey: key, lastEventTime: time });
    }
    return acc;
  }, []);

  return (
    <aside
      style={{
        width: effectivelyCollapsed ? 48 : 320,
        minWidth: effectivelyCollapsed ? 48 : 320,
        transition: 'width 150ms ease, min-width 150ms ease',
      }}
      className={cn(
        'relative flex flex-col h-full',
        'bg-bg-panel border-r border-[hsl(var(--border))]',
        'overflow-hidden',
      )}
    >
      {/* Toggle button — hidden when forceCollapsed is active (breakpoint manages it) */}
      {forceCollapsed === undefined && (
        <div
          className={cn(
            'shrink-0 flex items-center border-b border-[hsl(var(--border))] px-2 py-2',
            effectivelyCollapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <button
            type="button"
            onClick={toggle}
            title={effectivelyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
          >
            {effectivelyCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className={cn('p-2 space-y-4', effectivelyCollapsed && 'space-y-2')}>
          {/* Approvals section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<CheckSquare className="h-4 w-4" />}
              label={t('opsV2.rail.approvals')}
              count={approvalItems.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'approval'}
              onClick={() => handleSectionClick('approval')}
            />
            {!effectivelyCollapsed && approvalItems.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">
                {t('opsV2.empty.noPendingApprovals')}
              </p>
            )}
            {approvalItems.map((item) => (
              <ApprovalRow key={item.id} approval={item} collapsed={effectivelyCollapsed} />
            ))}
          </div>

          {/* Active Issues section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<AlertCircle className="h-4 w-4" />}
              label={t('opsV2.rail.activeIssues')}
              count={groupedIncidents.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'incident'}
              onClick={() => handleSectionClick('incident')}
            />

            {!effectivelyCollapsed && (
              <div className="px-2 py-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-ol" />
                  <Input
                    data-testid="incident-search-input"
                    placeholder={t('opsV2.rail.searchIncidents')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-7 pl-7 text-xs bg-bg-app border-[hsl(var(--border))] focus-visible:ring-1"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-ol" />
                  )}
                </div>
              </div>
            )}

            {!effectivelyCollapsed && groupedIncidents.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">
                {searchResults !== null ? (
                  <span data-testid="incident-search-empty">
                    {t('opsV2.empty.noSearchResults')}
                  </span>
                ) : (
                  t('opsV2.empty.noActiveIssues')
                )}
              </p>
            )}
            {groupedIncidents.map(({ incident, count, groupKey, lastEventTime }) => (
              <IncidentRow
                key={groupKey}
                incident={incident}
                count={count}
                lastEventTime={lastEventTime}
                collapsed={effectivelyCollapsed}
                onClick={() => onIncidentSelect?.(incident.id)}
              />
            ))}
          </div>

          {/* Circuit Breaker Status section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              label={t('opsV2.rail.circuitBreakerStatus')}
              count={openBreakers.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'circuit_breaker'}
              onClick={() => handleSectionClick('circuit_breaker')}
            />
            {!effectivelyCollapsed && openBreakers.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.allSystemsNormal')}</p>
            )}
            {openBreakers.map((cb, i) => (
              <CircuitBreakerRow
                key={cb.projectId}
                breaker={cb}
                index={i}
                collapsed={effectivelyCollapsed}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
