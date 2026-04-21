import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DensityMode = 'all' | 'actions-only' | 'critical-only';

export interface FilterState {
  density: DensityMode;
  severity?: string;
  projectId?: string;
  timeRange?: string;
}

export interface FilterBarProps {
  filters: FilterState;
  projects: { id: string; name: string }[];
  onFilterChange: (filters: FilterState) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DENSITY_OPTIONS: { value: DensityMode; labelKey: keyof typeof DENSITY_LABELS }[] = [
  { value: 'all', labelKey: 'all' },
  { value: 'actions-only', labelKey: 'actionsOnly' },
  { value: 'critical-only', labelKey: 'criticalOnly' },
];

const DENSITY_LABELS = {
  all: 'opsV2.filters.density.all',
  actionsOnly: 'opsV2.filters.density.actionsOnly',
  criticalOnly: 'opsV2.filters.density.criticalOnly',
} as const;

const SEVERITY_OPTIONS = ['critical', 'warning', 'info'] as const;

const TIME_RANGE_OPTIONS = ['1h', '6h', '24h', '7d', '30d'] as const;

// Map URL param names to filter state keys
const PARAM_KEYS = {
  density: 'density',
  severity: 'severity',
  projectId: 'project',
  timeRange: 'timeRange',
} as const;

// ---------------------------------------------------------------------------
// Hook: sync filters with URL search params
// ---------------------------------------------------------------------------

export function useFilterSearchParams(): [FilterState, (next: FilterState) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: FilterState = {
    density: (() => {
      const raw = searchParams.get(PARAM_KEYS.density);
      return raw && ['all', 'actions-only', 'critical-only'].includes(raw)
        ? (raw as DensityMode)
        : 'all';
    })(),
    severity: searchParams.get(PARAM_KEYS.severity) ?? undefined,
    projectId: searchParams.get(PARAM_KEYS.projectId) ?? undefined,
    timeRange: searchParams.get(PARAM_KEYS.timeRange) ?? undefined,
  };

  const setFilters = useCallback(
    (next: FilterState) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);

          if (next.density && next.density !== 'all') {
            params.set(PARAM_KEYS.density, next.density);
          } else {
            params.delete(PARAM_KEYS.density);
          }

          if (next.severity) {
            params.set(PARAM_KEYS.severity, next.severity);
          } else {
            params.delete(PARAM_KEYS.severity);
          }

          if (next.projectId) {
            params.set(PARAM_KEYS.projectId, next.projectId);
          } else {
            params.delete(PARAM_KEYS.projectId);
          }

          if (next.timeRange) {
            params.set(PARAM_KEYS.timeRange, next.timeRange);
          } else {
            params.delete(PARAM_KEYS.timeRange);
          }

          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilters];
}

// ---------------------------------------------------------------------------
// FilterBar component
// ---------------------------------------------------------------------------

export function FilterBar({ filters, projects, onFilterChange }: FilterBarProps) {
  const { t } = useLanguage();

  const handleDensityChange = (value: string) => {
    onFilterChange({ ...filters, density: value as DensityMode });
  };

  const handleSeverityChange = (value: string) => {
    onFilterChange({ ...filters, severity: value === '_all' ? undefined : value });
  };

  const handleProjectChange = (value: string) => {
    onFilterChange({ ...filters, projectId: value === '_all' ? undefined : value });
  };

  const handleTimeRangeChange = (value: string) => {
    onFilterChange({ ...filters, timeRange: value === '_all' ? undefined : value });
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 overflow-x-auto',
        'border rounded-md border-[hsl(var(--border))]',
        'bg-bg-panel text-xs',
      )}
    >
      {/* Density */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-foreground whitespace-nowrap">
          {t('opsV2.filters.density.label')}
        </span>
        <Select value={filters.density} onValueChange={handleDensityChange}>
          <SelectTrigger className="h-7 min-w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DENSITY_OPTIONS.map(({ value, labelKey }) => (
              <SelectItem key={value} value={value} className="text-xs">
                {t(DENSITY_LABELS[labelKey])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Severity */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-foreground whitespace-nowrap">
          {t('opsV2.filters.severity')}
        </span>
        <Select value={filters.severity ?? '_all'} onValueChange={handleSeverityChange}>
          <SelectTrigger className="h-7 min-w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {SEVERITY_OPTIONS.map((sev) => (
              <SelectItem key={sev} value={sev} className="text-xs capitalize">
                {sev}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-foreground whitespace-nowrap">
          {t('opsV2.filters.project')}
        </span>
        <Select value={filters.projectId ?? '_all'} onValueChange={handleProjectChange}>
          <SelectTrigger className="h-7 min-w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {projects.map((proj) => (
              <SelectItem key={proj.id} value={proj.id} className="text-xs">
                {proj.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Time range */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-foreground whitespace-nowrap">
          {t('opsV2.filters.timeRange')}
        </span>
        <Select value={filters.timeRange ?? '_all'} onValueChange={handleTimeRangeChange}>
          <SelectTrigger className="h-7 min-w-[110px] text-xs" data-testid="time-range-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs" data-testid="time-range-option-_all">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {TIME_RANGE_OPTIONS.map((range) => (
              <SelectItem
                key={range}
                value={range}
                className="text-xs"
                data-testid={`time-range-option-${range}`}
              >
                {t(`opsV2.filters.timeRangeOptions.${range}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
