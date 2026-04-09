import { useState, useEffect, useCallback } from 'react';
import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import { humanizeEventType } from '../utils.js';
import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
import type { ActionRun } from '../../../lib/api/projects.js';

const STORAGE_KEY = 'ops-v2-rail-collapsed';

export interface LeftRailProps {
  approvals: ActionRun[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  onFilterChange?: (filter: { type?: string; severity?: string }) => void;
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
  collapsed,
}: {
  incident: OpsIncident;
  count: number;
  collapsed: boolean;
}) {
  const { t } = useLanguage();
  const severityColor =
    incident.severity === 'critical'
      ? 'bg-error'
      : incident.severity === 'warning'
        ? 'bg-warning'
        : 'bg-muted-ol';

  const displayTitle = incident.triggerType
    ? humanizeEventType(incident.triggerType, t)
    : incident.title;

  const titleWithCount = count > 1 ? `${displayTitle} (×${count})` : displayTitle;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span
          className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
          title={titleWithCount}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{titleWithCount}</span>
    </div>
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
  const isOpen = breaker.state === 'open';
  const isHalfOpen = breaker.state === 'half_open';
  const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
  const displayName = breaker.projectName || `CB #${index + 1}`;
  const label = `${displayName}: ${breaker.state}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{label}</span>
    </div>
  );
}

export function LeftRail({
  approvals,
  incidents,
  circuitBreakers,
  onFilterChange,
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

  // Group incidents by humanized trigger type (or title) to deduplicate
  const groupedIncidents = incidents.reduce<Array<{ incident: OpsIncident; count: number }>>(
    (acc, incident) => {
      const key = incident.triggerType ?? incident.title;
      const existing = acc.find((g) => (g.incident.triggerType ?? g.incident.title) === key);
      if (existing) {
        existing.count += 1;
      } else {
        acc.push({ incident, count: 1 });
      }
      return acc;
    },
    [],
  );

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
              count={incidents.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'incident'}
              onClick={() => handleSectionClick('incident')}
            />
            {!effectivelyCollapsed && incidents.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
            )}
            {groupedIncidents.map(({ incident, count }) => (
              <IncidentRow
                key={incident.triggerType ?? incident.id}
                incident={incident}
                count={count}
                collapsed={effectivelyCollapsed}
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
