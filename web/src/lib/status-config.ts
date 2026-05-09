/**
 * Centralized status → visual display mapping.
 *
 * Replaces 5 duplicated getStatusConfig() definitions across
 * ProjectsGrid, Overview, ProjectHeader, ServiceHeader, Sidebar.
 *
 * Dots are STATIC (dokploy pattern). If a consumer genuinely needs
 * attention-grabbing motion, apply `animate-pulse` via className override.
 *
 * i18n labels are passed by the caller (not hard-coded here) so this lib
 * does not touch the shared en.ts/ko.ts — each consumer retains its
 * existing label flow and i18n namespace.
 */

export type AppStatus = 'running' | 'stopped' | 'building' | 'error' | 'idle';

export interface StatusDisplay {
  /** Pre-composed dot bg class. */
  dot: string;
  /** Pre-composed pill-badge className (inline legacy — new sites may use <Badge variant={badgeVariant} />). */
  badge: string;
  /** Semantic Badge variant for new call sites. */
  badgeVariant: 'green' | 'yellow' | 'red' | 'neutral';
  /** Text color class for inline status text. */
  textClass: string;
  /** Card-outline accent class. */
  border: string;
}

const STATUS_MAP: Record<AppStatus, StatusDisplay> = {
  running: {
    dot: 'bg-success',
    badge: 'bg-success/10 text-success border border-success/30',
    badgeVariant: 'green',
    textClass: 'text-success',
    border: 'border-success/20',
  },
  stopped: {
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground border border-border',
    badgeVariant: 'neutral',
    textClass: 'text-muted-foreground',
    border: 'border-[hsl(var(--border))]',
  },
  building: {
    dot: 'bg-warning',
    badge: 'bg-warning/10 text-warning border border-warning/30',
    badgeVariant: 'yellow',
    textClass: 'text-warning',
    border: 'border-warning/30',
  },
  error: {
    dot: 'bg-error',
    badge: 'bg-error/10 text-error border border-error/30',
    badgeVariant: 'red',
    textClass: 'text-error',
    border: 'border-error/30',
  },
  idle: {
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground border border-border',
    badgeVariant: 'neutral',
    textClass: 'text-muted-foreground',
    border: 'border-[hsl(var(--border))]',
  },
};

export function getStatusDisplay(status: string): StatusDisplay {
  return STATUS_MAP[status as AppStatus] ?? STATUS_MAP.stopped;
}

export interface StatusLabelMap {
  running?: string;
  stopped?: string;
  building?: string;
  error?: string;
  idle?: string;
}

export interface StatusConfigEntry {
  label: string;
  dot: string;
  badge: string;
  border: string;
}

/**
 * Legacy-shape adapter: returns `Record<string, { label, dot, badge, border }>`
 * compatible with existing ProjectsGrid / Overview call sites. Labels come
 * from the caller to preserve their i18n flow.
 */
export function getStatusConfigMap(labels: StatusLabelMap): Record<string, StatusConfigEntry> {
  const out: Record<string, StatusConfigEntry> = {};
  for (const key of Object.keys(STATUS_MAP) as AppStatus[]) {
    const def = STATUS_MAP[key];
    out[key] = {
      label: labels[key] ?? key,
      dot: def.dot,
      badge: def.badge,
      border: def.border,
    };
  }
  return out;
}
