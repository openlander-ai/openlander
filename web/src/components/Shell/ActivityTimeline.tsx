/**
 * ActivityTimeline — shared timeline primitive.
 *
 * Used by:
 *   - Home page (the Unified Activity Stream)
 *   - Activity page (with filter pills + bucketing)
 *   - MCP Server page (filtered to MCP-actor events)
 *
 * Linear/Vercel tone:
 *   Actor identity is a small mono-tagged "label", not a colored circle
 *   icon. Bot icon appears ONLY when actor === 'mcp' so the agent
 *   presence reads at a glance without lighting up every row.
 *
 * Reasoning text:
 *   Single inline `detail` line per event. NO collapsible expansion.
 *   Multi-paragraph LLM reasoning is a v1.1+ feature.
 */
import { useMemo, useState } from 'react';
import { Bot, Webhook, User, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import {
  bucketByTime,
  filterEvents,
  isKindInGroup,
  type Actor,
  type ActivityEvent,
  type ActivityFilters,
  type KindGroup,
  type ProjectSummary,
} from '@/lib/agentActivity';

const ACTOR_META: Record<
  Actor,
  { label: string; tone: 'mcp' | 'human' | 'webhook' | 'system'; Icon: typeof Bot }
> = {
  mcp: { label: 'mcp', tone: 'mcp', Icon: Bot },
  human: { label: 'human', tone: 'human', Icon: User },
  webhook: { label: 'webhook', tone: 'webhook', Icon: Webhook },
  system: { label: 'system', tone: 'system', Icon: SettingsIcon },
};

const TONE_BG: Record<string, string> = {
  mcp: 'color-mix(in oklch, var(--ol-actor-mcp) 14%, transparent)',
  human: 'color-mix(in oklch, var(--ol-actor-human) 10%, transparent)',
  webhook: 'color-mix(in oklch, var(--ol-actor-webhook) 14%, transparent)',
  system: 'color-mix(in oklch, var(--ol-actor-system) 12%, transparent)',
};
const TONE_FG: Record<string, string> = {
  mcp: 'var(--ol-actor-mcp)',
  human: 'var(--ol-actor-human)',
  webhook: 'var(--ol-actor-webhook)',
  system: 'var(--ol-actor-system)',
};

export interface ActivityRowProps {
  event: ActivityEvent;
  /** Compact density (used in Home stream / inline cards) */
  compact?: boolean;
  /** Whether to draw the connecting rail under this row */
  isLast?: boolean;
  onOpenService?: (project: string, service: string) => void;
  /** Click handler for deploy_* events. Receives the deployment id
   *  (server-side: event.id has the form `deploy-<id>`) plus the
   *  project id (non-null at call time per the guard) so the consumer
   *  can construct the nested `/projects/:id/deployments/:deployId`
   *  route required by DeploymentDetail. */
  onOpenDeployment?: (deploymentId: string, projectId: string) => void;
}

export function ActivityRow({
  event,
  compact,
  isLast,
  onOpenService,
  onOpenDeployment,
}: ActivityRowProps) {
  const meta = ACTOR_META[event.actor];
  const Icon = meta.Icon;
  const showBotIcon = event.actor === 'mcp';
  return (
    <div className={cn('relative flex gap-3 px-4', compact ? 'py-2.5' : 'py-3.5')}>
      {/* Gutter rail */}
      <div className="relative flex w-14 shrink-0 flex-col items-start pt-0.5">
        <span
          className="ol-mono inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
          style={{
            backgroundColor: TONE_BG[meta.tone],
            color: TONE_FG[meta.tone],
          }}
        >
          {showBotIcon && <Icon className="h-3 w-3" />}
          {meta.label}
        </span>
        {!isLast && (
          <span
            aria-hidden
            className="absolute left-[7px] top-7 bottom-[-14px] w-px"
            style={{ backgroundColor: 'var(--ol-border-subtle)' }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {isKindInGroup(event.kind, 'deploys') && onOpenDeployment && event.project ? (
            (() => {
              // event.id has the form `deploy-<deploymentId>` per
              // src/web/api/activity-routes.ts. Strip the prefix to deep-link.
              const deploymentId = event.id.startsWith('deploy-')
                ? event.id.slice('deploy-'.length)
                : event.id;
              const projectId = event.project;
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDeployment(deploymentId, projectId);
                  }}
                  className="text-left text-[13.5px] leading-snug text-[color:var(--ol-fg)] transition-colors hover:text-[color:var(--ol-primary)] hover:underline"
                >
                  {event.title}
                </button>
              );
            })()
          ) : (
            <span className="text-[13.5px] leading-snug text-[color:var(--ol-fg)]">
              {event.title}
            </span>
          )}
          {event.project && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (event.service && onOpenService) {
                  onOpenService(event.project!, event.service);
                }
              }}
              disabled={!event.service || !onOpenService}
              className={cn(
                'ol-mono rounded border px-1.5 py-px text-[11px] leading-none',
                'border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
                event.service && onOpenService
                  ? 'transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]'
                  : 'cursor-default',
              )}
            >
              {event.project}
              {event.service ? `/${event.service}` : ''}
            </button>
          )}
          <span className="ml-auto text-[11px] text-[color:var(--ol-fg-subtle)]">{event.at}</span>
        </div>
        {event.detail && (
          <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--ol-fg-muted)]">
            {event.detail}
          </p>
        )}
      </div>
    </div>
  );
}

export interface ActivityTimelineProps {
  events: ActivityEvent[];
  onOpenService?: (project: string, service: string) => void;
  /** Click handler for deploy_* rows. When provided AND the row is a
   *  deploy event with a non-null project, the title becomes a
   *  clickable deep-link to the deployment detail page. */
  onOpenDeployment?: (deploymentId: string, projectId: string) => void;
  /** Show filter pills above the stream (Activity page) */
  showFilters?: boolean;
  /** When showFilters is true, project pill needs the project list */
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

  const buckets = useMemo(() => (bucketed ? bucketByTime(filtered) : null), [filtered, bucketed]);

  const empty = filtered.length === 0;

  const renderRow = (e: ActivityEvent, i: number, total: number) => (
    <ActivityRow
      key={e.id}
      event={e}
      isLast={i === total - 1}
      onOpenService={onOpenService}
      onOpenDeployment={onOpenDeployment}
    />
  );

  return (
    <div className={cn('flex flex-col', className)}>
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--ol-border-subtle)] px-4 py-3">
          <FilterPills
            label="Actor"
            value={filters.actor}
            onChange={(v) => setFilters((f) => ({ ...f, actor: v as ActivityFilters['actor'] }))}
            options={[
              { v: 'all', label: 'All', count: events.length },
              {
                v: 'mcp',
                label: 'MCP',
                count: events.filter((e) => e.actor === 'mcp').length,
                tone: 'mcp',
              },
              {
                v: 'human',
                label: 'Human',
                count: events.filter((e) => e.actor === 'human').length,
              },
              {
                v: 'webhook',
                label: 'Git',
                count: events.filter((e) => e.actor === 'webhook').length,
                tone: 'webhook',
              },
              {
                v: 'system',
                label: 'System',
                count: events.filter((e) => e.actor === 'system').length,
              },
            ]}
          />
          <FilterPills
            label={t('activity.filter.type.label')}
            value={effectiveFilters.kind ?? 'all'}
            onChange={(v) => {
              const next = v as KindGroup;
              if (onKindFilterChange) {
                onKindFilterChange(next);
                return;
              }
              setFilters((f) => ({ ...f, kind: next }));
            }}
            options={[
              { v: 'all', label: t('activity.filter.type.all'), count: events.length },
              {
                v: 'deploys',
                label: t('activity.filter.type.deploy'),
                count: events.filter((e) => isKindInGroup(e.kind, 'deploys')).length,
              },
              {
                v: 'crashes',
                label: t('activity.filter.type.crash'),
                count: events.filter((e) => isKindInGroup(e.kind, 'crashes')).length,
              },
              {
                v: 'mcp',
                label: t('activity.filter.type.mcp'),
                count: events.filter((e) => isKindInGroup(e.kind, 'mcp')).length,
                tone: 'mcp',
              },
              {
                v: 'config',
                label: t('activity.filter.type.config'),
                count: events.filter((e) => isKindInGroup(e.kind, 'config')).length,
              },
            ]}
          />
          {projects && projects.length > 0 && (
            <FilterPills
              label="Project"
              value={effectiveFilters.project}
              onChange={(v) => {
                if (onProjectFilterChange) {
                  onProjectFilterChange(v);
                  return;
                }
                setFilters((f) => ({ ...f, project: v }));
              }}
              options={[
                { v: 'all', label: 'All projects' },
                ...projects.map((p) => ({ v: p.id, label: p.name })),
              ]}
            />
          )}
        </div>
      )}

      {empty ? (
        <div className="px-6 py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
          {emptyState ?? 'No activity yet.'}
        </div>
      ) : bucketed && buckets ? (
        <div>
          {buckets.map(([bucketLabel, items]) => (
            <div key={bucketLabel}>
              <div className="border-y border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
                {bucketLabel}
              </div>
              <ul className="flex flex-col">
                {items.map((e, i) => (
                  <li key={e.id}>{renderRow(e, i, items.length)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((e, i) => (
            <li key={e.id}>{renderRow(e, i, filtered.length)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FilterPillOption {
  v: string;
  label: string;
  count?: number;
  tone?: 'mcp' | 'webhook';
}

interface FilterPillsProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterPillOption[];
}

function FilterPills({ label, value, onChange, options }: FilterPillsProps) {
  // Use a unique id per FilterPills instance so multiple pill groups
  // (Actor, Project, …) can each be associated with their own visible
  // label without colliding.
  const groupLabelId = `filter-pills-label-${label.toLowerCase()}`;
  return (
    <div className="flex items-center gap-2">
      <span
        id={groupLabelId}
        className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]"
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={groupLabelId}
        className="flex flex-wrap items-center gap-1"
      >
        {options.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.v)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                active
                  ? 'border-[color:var(--ol-fg)] bg-[color:var(--ol-fg)] text-[color:var(--ol-panel)]'
                  : 'border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
              )}
              style={
                !active && o.tone
                  ? {
                      color: TONE_FG[o.tone],
                    }
                  : undefined
              }
            >
              <span>{o.label}</span>
              {o.count != null && (
                <span className={cn('ol-mono text-[10px]', active ? 'opacity-80' : 'opacity-60')}>
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ActivityTimeline;
