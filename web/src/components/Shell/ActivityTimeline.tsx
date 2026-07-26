/**
 * ActivityTimeline — shared timeline primitive.
 *
 * Used by:
 *   - Home page (the recent-activity peek)
 *   - Activity page (with tab strip + bucketing)
 *   - MCP Server page (filtered to MCP-actor events)
 *
 * Information hierarchy (post-IA cleanup):
 *   1. Left rail: small status icon + accent color. Failure / crash gets a
 *      louder treatment; success and config stay neutral.
 *   2. Title: event name in the standard fg color (e.g. "Deploy succeeded",
 *      "Service crashed", "Environment variables set").
 *   3. Meta line below the title: `project / service · actor · time` in a
 *      single muted row. Display names are preferred over raw IDs; the
 *      backend ships `projectName` / `serviceName` when known and the row
 *      strips the legacy `__svc` suffix off bare service IDs as a fallback.
 *   4. Detail: optional one-line context (commit message, exit code, etc.)
 *      rendered subtle. Successes can omit it entirely.
 *
 * Failure / crash rows get an accent border-left and the title turns the
 * error color so they stand out without changing the row height. Everything
 * else stays calm — a long quiet timeline is the goal.
 */
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  PowerOff,
  RotateCcw,
  Settings as SettingsIcon,
  Webhook,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import {
  bucketByTime,
  filterEvents,
  isKindInGroup,
  severityForKind,
  type Actor,
  type ActivityEvent,
  type ActivityFilters,
  type ActivityKind,
  type ActivitySeverity,
  type KindGroup,
  type ProjectSummary,
} from '@/lib/agentActivity';
import {
  localizedActivityDetail,
  localizedActivityRelativeTime,
  localizedActivityTitle,
} from '@/lib/activity-presentation';

interface KindMeta {
  Icon: LucideIcon;
}

const KIND_ICON: Record<ActivityKind, KindMeta> = {
  deploy_started: { Icon: Loader2 },
  deploy_completed: { Icon: CheckCircle2 },
  deploy_failed: { Icon: XCircle },
  deploy_cancelled: { Icon: PowerOff },
  config_changed: { Icon: SettingsIcon },
  data_access_read: { Icon: Database },
  service_crashed: { Icon: AlertTriangle },
  service_recovered: { Icon: RotateCcw },
  mcp_connected: { Icon: Bot },
  mcp_disconnected: { Icon: Bot },
};

interface SeverityStyle {
  /** Foreground/icon color (CSS var ref). */
  fg: string;
  /** Soft chip background for the icon disc. */
  bg: string;
  /** Whether the row should pick up a louder accent (left border + title color). */
  loud: boolean;
}

const SEVERITY_STYLE: Record<ActivitySeverity, SeverityStyle> = {
  success: {
    fg: 'var(--ol-success)',
    bg: 'color-mix(in oklch, var(--ol-success) 12%, transparent)',
    loud: false,
  },
  failure: {
    fg: 'var(--ol-error)',
    bg: 'color-mix(in oklch, var(--ol-error) 14%, transparent)',
    loud: true,
  },
  warning: {
    fg: 'var(--ol-warning)',
    bg: 'color-mix(in oklch, var(--ol-warning) 14%, transparent)',
    loud: false,
  },
  info: {
    fg: 'var(--ol-actor-mcp)',
    bg: 'color-mix(in oklch, var(--ol-actor-mcp) 12%, transparent)',
    loud: false,
  },
  neutral: {
    fg: 'var(--ol-fg-subtle)',
    bg: 'var(--ol-panel-2)',
    loud: false,
  },
};

const ACTOR_ICON: Partial<Record<Actor, LucideIcon>> = {
  mcp: Bot,
  webhook: Webhook,
};

/** Normalize the service segment we render in the row meta. The legacy
 *  `{project}__svc` shape is used for single-Application Projects where the
 *  Application is conceptually the project itself — both the row's
 *  `event.service` (id) and `event.serviceName` (the services-row name)
 *  can end with `__svc`, so this strip has to run on the chosen
 *  candidate, not only on the raw id fallback.
 *
 *  Returns `null` when the stripped result matches any known project
 *  identifier (display name OR id) — at that point the service is the
 *  anonymous single Application and the meta line is cleaner without it. */
function normalizeServiceSegment(
  raw: string | null | undefined,
  ...projectAliases: Array<string | null | undefined>
): string | null {
  if (!raw) return null;
  const stripped = raw.endsWith('__svc') ? raw.slice(0, -'__svc'.length) : raw;
  for (const alias of projectAliases) {
    if (alias && stripped === alias) return null;
  }
  return stripped;
}

export interface ActivityRowProps {
  event: ActivityEvent;
  /** Compact density (used in Home stream / inline cards) */
  compact?: boolean;
  onOpenService?: (project: string, service: string) => void;
  /** Click handler for deploy_* events. Receives the deployment id
   *  (server-side: event.id has the form `deploy-<id>`) plus the
   *  project id (non-null at call time per the guard) so the consumer
   *  can construct the nested `/projects/:id/deployments/:deployId`
   *  route required by DeploymentDetail. */
  onOpenDeployment?: (deploymentId: string, projectId: string) => void;
  /** Optional project-id → display-name resolver. Falls back to
   *  `event.projectName`, then the raw id. */
  resolveProjectName?: (projectId: string) => string | null;
}

export function ActivityRow({
  event,
  compact,
  onOpenService,
  onOpenDeployment,
  resolveProjectName,
}: ActivityRowProps) {
  const { t } = useLanguage();
  const severity = severityForKind(event.kind);
  const sev = SEVERITY_STYLE[severity];
  const { Icon } = KIND_ICON[event.kind];
  const ActorIcon = ACTOR_ICON[event.actor];
  const actorLabel: Record<Actor, string> = {
    mcp: 'MCP',
    human: t('activityFilters.actor.human'),
    webhook: t('activityFilters.actor.git'),
    system: t('activityFilters.actor.system'),
  };
  const relativeAt = localizedActivityRelativeTime(event, t);
  const displayTitle = localizedActivityTitle(event, t);
  const displayDetail = localizedActivityDetail(event, t);

  const projectDisplay = event.project
    ? (resolveProjectName?.(event.project) ?? event.projectName ?? event.project)
    : null;
  // Pick the best service candidate (backend-shipped name first, then raw
  // id) and run it through the shared normalizer so `${project}__svc`
  // suffixes collapse out regardless of which field carried them.
  const serviceDisplay = normalizeServiceSegment(
    event.serviceName ?? event.service,
    event.project,
    event.projectName,
    projectDisplay,
  );

  const isDeploy = isKindInGroup(event.kind, 'deploys');
  const canOpenDeployment = isDeploy && onOpenDeployment != null && event.project != null;
  const canOpenService = event.project != null && event.service != null && onOpenService != null;

  const titleClass = cn(
    'text-[13.5px] font-medium leading-snug',
    sev.loud
      ? 'text-[color:var(--ol-error)]'
      : severity === 'success'
        ? 'text-[color:var(--ol-fg)]'
        : 'text-[color:var(--ol-fg)]',
  );

  const handleTitleClick = (e: React.MouseEvent) => {
    if (!canOpenDeployment || !event.project) return;
    e.stopPropagation();
    const deploymentId = event.id.startsWith('deploy-')
      ? event.id.slice('deploy-'.length)
      : event.id;
    onOpenDeployment?.(deploymentId, event.project);
  };

  return (
    <div
      className={cn(
        'group relative flex gap-3 border-l-2 px-4 transition-colors',
        compact ? 'py-2.5' : 'py-3',
        sev.loud
          ? 'border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_4%,transparent)]'
          : 'border-transparent hover:bg-[color:var(--ol-panel-2)]',
      )}
    >
      {/* Left status disc */}
      <div
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: sev.bg, color: sev.fg }}
        aria-hidden
      >
        <Icon className={cn('h-3.5 w-3.5', event.kind === 'deploy_started' && 'animate-spin')} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Title + time */}
        <div className="flex items-baseline gap-2">
          {canOpenDeployment ? (
            <button
              type="button"
              onClick={handleTitleClick}
              className={cn(titleClass, 'text-left hover:underline')}
            >
              {displayTitle}
            </button>
          ) : (
            <span className={titleClass}>{displayTitle}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-[color:var(--ol-fg-subtle)]">
            {relativeAt}
          </span>
        </div>

        {/* Meta line — project · service · actor */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-[color:var(--ol-fg-muted)]">
          {projectDisplay && (
            <button
              type="button"
              disabled={!canOpenService}
              onClick={(e) => {
                if (!canOpenService) return;
                e.stopPropagation();
                onOpenService?.(event.project!, event.service!);
              }}
              className={cn(
                'truncate',
                canOpenService
                  ? 'transition-colors hover:text-[color:var(--ol-fg)] hover:underline'
                  : 'cursor-default',
              )}
            >
              {projectDisplay}
              {serviceDisplay && (
                <span className="text-[color:var(--ol-fg-subtle)]"> / {serviceDisplay}</span>
              )}
            </button>
          )}
          {projectDisplay && <Separator />}
          <span className="inline-flex items-center gap-1">
            {ActorIcon && <ActorIcon className="h-3 w-3 opacity-70" />}
            {actorLabel[event.actor]}
          </span>
        </div>

        {displayDetail && (
          <p
            className={cn(
              'mt-1 line-clamp-2 text-[12px] leading-snug',
              sev.loud ? 'text-[color:var(--ol-fg)]' : 'text-[color:var(--ol-fg-muted)]',
            )}
          >
            {displayDetail}
          </p>
        )}
        {event.kind === 'data_access_read' && event.dataAccess && (
          <DataAccessAuditStrip summary={event.dataAccess} />
        )}
      </div>
    </div>
  );
}

function DataAccessAuditStrip({ summary }: { summary: ActivityEvent['dataAccess'] }) {
  const { t } = useLanguage();
  if (!summary) return null;
  const hash = summary.queryHash ? summary.queryHash.slice(0, 8) : null;
  const chips = [
    t('activity.dataAccess.operation', { operation: summary.operation }),
    summary.sourceKind ? t('activity.dataAccess.source', { kind: summary.sourceKind }) : null,
    summary.rowCount != null ? t('activity.dataAccess.results', { count: summary.rowCount }) : null,
    summary.durationMs != null
      ? t('activity.dataAccess.duration', { duration: summary.durationMs })
      : null,
    summary.truncated ? t('activity.dataAccess.truncated') : null,
    hash ? t('activity.dataAccess.hash', { hash }) : null,
  ].filter((chip): chip is string => chip != null && chip.length > 0);

  if (chips.length === 0 && !summary.preview) return null;

  return (
    <div className="mt-2 min-w-0 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] px-1.5 py-0.5 text-[10.5px] text-[color:var(--ol-fg-muted)]"
          >
            {chip}
          </span>
        ))}
      </div>
      {summary.preview && (
        <div className="mt-1.5 grid min-w-0 gap-1">
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
            {t('activity.dataAccess.preview')}
          </span>
          <span className="ol-mono min-w-0 max-w-full truncate rounded bg-[color:var(--ol-panel)] px-2 py-1 text-[10.5px] text-[color:var(--ol-fg-subtle)]">
            {summary.preview}
          </span>
        </div>
      )}
    </div>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-[color:var(--ol-fg-subtle)]">
      ·
    </span>
  );
}

export interface ActivityTimelineProps {
  events: ActivityEvent[];
  onOpenService?: (project: string, service: string) => void;
  /** Click handler for deploy_* rows. When provided AND the row is a
   *  deploy event with a non-null project, the title becomes a
   *  clickable deep-link to the deployment detail page. */
  onOpenDeployment?: (deploymentId: string, projectId: string) => void;
  /** Show the type tab strip + project filter (Activity page). */
  showFilters?: boolean;
  /** When showFilters is true, the project filter renders with this list. */
  projects?: ProjectSummary[];
  kindFilter?: KindGroup;
  onKindFilterChange?: (kind: KindGroup) => void;
  projectFilter?: string;
  onProjectFilterChange?: (project: string) => void;
  /** Show time-bucket headers (Just now / Earlier today / Yesterday) */
  bucketed?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
}

export function ActivityTimeline({
  events,
  onOpenService,
  onOpenDeployment,
  showFilters = false,
  projects,
  kindFilter,
  onKindFilterChange,
  projectFilter,
  onProjectFilterChange,
  bucketed = false,
  emptyState,
  className,
}: ActivityTimelineProps) {
  const { t } = useLanguage();
  const [filters, setFilters] = useState<ActivityFilters>({
    actor: 'all',
    project: 'all',
    kind: 'all',
  });
  const effectiveFilters = useMemo<ActivityFilters>(
    () => ({
      ...filters,
      kind: kindFilter ?? filters.kind,
      project: projectFilter ?? filters.project,
    }),
    [filters, kindFilter, projectFilter],
  );
  const filtered = useMemo(
    () => (showFilters ? filterEvents(events, effectiveFilters) : events),
    [events, effectiveFilters, showFilters],
  );

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.id, p.name);
    return m;
  }, [projects]);
  const resolveProjectName = (id: string): string | null => projectNameById.get(id) ?? null;

  const buckets = useMemo(() => (bucketed ? bucketByTime(filtered) : null), [filtered, bucketed]);

  const empty = filtered.length === 0;

  const tabs = useMemo(
    () => [
      { v: 'all' as KindGroup, label: t('activity.filter.type.all'), count: events.length },
      {
        v: 'deploys' as KindGroup,
        label: t('activity.filter.type.deploy'),
        count: events.filter((e) => isKindInGroup(e.kind, 'deploys')).length,
      },
      {
        v: 'mcp' as KindGroup,
        label: t('activity.filter.type.mcp'),
        count: events.filter((e) => isKindInGroup(e.kind, 'mcp')).length,
      },
      {
        v: 'system' as KindGroup,
        label: t('activity.filter.type.system'),
        count: events.filter((e) => isKindInGroup(e.kind, 'system')).length,
      },
      {
        v: 'config' as KindGroup,
        label: t('activity.filter.type.config'),
        count: events.filter((e) => isKindInGroup(e.kind, 'config')).length,
      },
      {
        v: 'data' as KindGroup,
        label: t('activity.filter.type.data'),
        count: events.filter((e) => isKindInGroup(e.kind, 'data')).length,
      },
    ],
    [events, t],
  );

  const renderRow = (e: ActivityEvent) => (
    <ActivityRow
      key={e.id}
      event={e}
      onOpenService={onOpenService}
      onOpenDeployment={onOpenDeployment}
      resolveProjectName={resolveProjectName}
    />
  );

  return (
    <div className={cn('flex flex-col', className)}>
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--ol-border-subtle)] px-3 py-2.5">
          <TabStrip
            value={effectiveFilters.kind ?? 'all'}
            onChange={(next) => {
              if (onKindFilterChange) {
                onKindFilterChange(next);
                return;
              }
              setFilters((f) => ({ ...f, kind: next }));
            }}
            tabs={tabs}
          />
          {projects && projects.length > 1 && (
            <ProjectSelect
              value={effectiveFilters.project}
              onChange={(v) => {
                if (onProjectFilterChange) {
                  onProjectFilterChange(v);
                  return;
                }
                setFilters((f) => ({ ...f, project: v }));
              }}
              projects={projects}
            />
          )}
        </div>
      )}

      {empty ? (
        <div className="px-6 py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
          {emptyState ?? t('activityFilters.empty')}
        </div>
      ) : bucketed && buckets ? (
        <div>
          {buckets.map(([bucketLabel, items]) => (
            <div key={bucketLabel}>
              <div className="border-y border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
                {bucketLabel === 'Just now'
                  ? t('activityFilters.bucket.justNow')
                  : bucketLabel === 'Earlier today'
                    ? t('activityFilters.bucket.earlierToday')
                    : t('activityFilters.bucket.yesterday')}
              </div>
              <ul className="flex flex-col divide-y divide-[color:var(--ol-border-subtle)]">
                {items.map((e) => (
                  <li key={e.id}>{renderRow(e)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--ol-border-subtle)]">
          {filtered.map((e) => (
            <li key={e.id}>{renderRow(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TabStripProps {
  value: KindGroup;
  onChange: (v: KindGroup) => void;
  tabs: Array<{ v: KindGroup; label: string; count: number }>;
}

function TabStrip({ value, onChange, tabs }: TabStripProps) {
  const { t } = useLanguage();

  return (
    <div
      role="tablist"
      aria-label={t('activityFilters.typeAria')}
      className="flex flex-wrap items-center gap-0.5"
    >
      {tabs.map((tab) => {
        const active = value === tab.v;
        return (
          <button
            key={tab.v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors',
              active
                ? 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg)]'
                : 'text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]',
            )}
          >
            <span className={cn(active && 'font-medium')}>{tab.label}</span>
            <span
              className={cn(
                'ol-mono text-[10.5px]',
                active ? 'text-[color:var(--ol-fg-muted)]' : 'text-[color:var(--ol-fg-subtle)]',
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface ProjectSelectProps {
  value: string;
  onChange: (v: string) => void;
  projects: ProjectSummary[];
}

function ProjectSelect({ value, onChange, projects }: ProjectSelectProps) {
  const { t } = useLanguage();

  return (
    <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[color:var(--ol-fg-subtle)]">
      <span className="uppercase tracking-[0.06em]">{t('activityFilters.project')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'rounded-md border bg-[color:var(--ol-panel)] px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)]',
          'border-[color:var(--ol-border-subtle)] hover:border-[color:var(--ol-border)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ol-border-strong)]',
        )}
      >
        <option value="all">{t('activityFilters.allProjects')}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default ActivityTimeline;
