/**
 * ProjectsGrid — v4 single-column list (Phase C rewrite).
 *
 * Matches v4 projects.jsx:
 *   - Single-column project list (not grid)
 *   - Controls row: filter input + Tags + Newest first
 *   - Empty state: "You don't have any projects yet" v4-exact copy
 *   - StatusPill per project
 *
 * 1.0-rc.2 (data-model fullsplit): rows render groups (formerly
 * projects). The `status` and `serviceCount` fields are P1 additive-
 * schema fields preserved on group rows during the transition so this
 * page keeps rendering without a behavioral rewire.
 */
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Folder, MoreHorizontal, Plus, X } from 'lucide-react';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useProjects } from '@/hooks/use-projects';
import { OuterCard } from '@/components/Shell/OuterCard';
import { createProjectGroup } from '@/lib/api/projects';
import { useLanguage } from '@/i18n/context';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

function getStatusPill(status: Project['status']): { cls: string; label: string } {
  const map: Record<Project['status'], { cls: string; label: string }> = {
    running: {
      cls: 'bg-[color-mix(in_oklch,var(--ol-success)_12%,transparent)] text-[color:var(--ol-success)]',
      label: 'Running',
    },
    building: {
      cls: 'bg-[color-mix(in_oklch,var(--ol-warning)_12%,transparent)] text-[color:var(--ol-warning)]',
      label: 'Deploying',
    },
    error: {
      cls: 'bg-[color-mix(in_oklch,var(--ol-error)_12%,transparent)] text-[color:var(--ol-error)]',
      label: 'Crashing',
    },
    stopped: {
      cls: 'bg-[color-mix(in_oklch,var(--ol-fg-subtle)_12%,transparent)] text-[color:var(--ol-fg-muted)]',
      label: 'Stopped',
    },
    idle: {
      cls: 'bg-[color-mix(in_oklch,var(--ol-fg-subtle)_12%,transparent)] text-[color:var(--ol-fg-muted)]',
      label: 'Idle',
    },
  };
  return map[status] ?? map.stopped;
}

function StatusPill({ status }: { status: Project['status'] }) {
  const { cls, label } = getStatusPill(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
        cls,
      )}
    >
      <span aria-hidden className="h-1 w-1 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function ProjectsGrid() {
  const navigate = useNavigate();
  const ctx = useProjectsContext();
  const { t } = useLanguage();
  const [showArchived, setShowArchived] = useState(false);
  // When the toggle is off (default), reuse the shared context so we don't
  // double-poll. When on, mount a per-page useProjects(true) so archived
  // rows show alongside live ones — they don't need to bleed into Sidebar /
  // Home / CommandPalette where the context is consumed. The hook's
  // `enabled` flag suppresses polling while the toggle is off.
  const archivedView = useProjects(true, { enabled: showArchived });
  const { projects, loading } = showArchived ? archivedView : ctx;
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = projects.filter((p) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      (p.displayName ?? p.name).toLowerCase().includes(needle) ||
      p.name.toLowerCase().includes(needle)
    );
  });

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) {
      setCreateError(t('projects.create.errors.nameRequired'));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createProjectGroup(name);
      await ctx.refetch();
      setCreateOpen(false);
      setProjectName('');
      navigate(`/projects/${result.project.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('projects.create.errors.fallback'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <OuterCard
        title={t('projects.pageTitle')}
        subtitle={t('projects.pageSubtitle')}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('projects.newProject')}
          </button>
        }
      >
        {loading && projects.length === 0 ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-[color:var(--ol-panel-2)]" />
            ))}
          </div>
        ) : filtered.length === 0 && !q ? (
          /* ── Empty state (v5-exact copy) ── */
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--ol-panel-2)]">
              <Folder className="h-6 w-6 text-[color:var(--ol-fg-muted)]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[color:var(--ol-fg)]">
                {t('projects.emptyTitle')}
              </h3>
              <p className="mt-1.5 max-w-md text-[13px] text-[color:var(--ol-fg-muted)]">
                {t('projects.emptyDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              {t('projects.createFirst')}
            </button>
          </div>
        ) : (
          <>
            {/* ── Controls row ── */}
            <div className="mb-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type="search"
                  placeholder={t('projects.filterPlaceholder')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-1.5 text-[13px] text-[color:var(--ol-fg)] placeholder:text-[color:var(--ol-fg-subtle)] focus:border-[color:var(--ol-border)] focus:outline-none"
                />
              </div>
              <button
                type="button"
                className="rounded-md border border-[color:var(--ol-border)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
              >
                {t('projects.tags')}
              </button>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-pressed={showArchived}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors',
                  showArchived
                    ? 'border-[color:var(--ol-border-strong)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg)]'
                    : 'border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
                )}
              >
                {showArchived
                  ? t('projects.filter.hideArchived')
                  : t('projects.filter.showArchived')}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
              >
                {t('projects.newestFirst')}
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* ── Project list ── */}
            <div className="flex flex-col gap-1">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
                  {t('projects.searchEmpty', { query: q })}
                </div>
              ) : (
                filtered.map((p) => {
                  const isArchived = p.archived_at != null;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-3 text-left transition-colors hover:border-[color:var(--ol-border)] hover:bg-[color:var(--ol-panel)]',
                        isArchived && 'opacity-60',
                      )}
                    >
                      {/* Project icon */}
                      <span
                        aria-hidden
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color:var(--ol-border)] text-[12px] font-semibold text-[color:var(--ol-fg-muted)]"
                      >
                        {(p.displayName ?? p.name).slice(0, 2).toUpperCase()}
                      </span>

                      {/* Meta */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-[color:var(--ol-fg)]">
                            {p.displayName ?? p.name}
                          </span>
                          {p.displayName && p.displayName !== p.name && (
                            <span className="ol-mono truncate text-[11px] text-[color:var(--ol-fg-subtle)]">
                              {p.name}
                            </span>
                          )}
                          {isArchived ? (
                            <span className="inline-flex items-center rounded-full bg-[color:var(--ol-panel)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--ol-fg-muted)]">
                              {t('projects.card.archivedBadge')}
                            </span>
                          ) : (
                            <>
                              {/* p is the frontend Project type (lib/api wire shape) — `status` is a
                                wire-format field, hydrated from services.* server-side post-0012. */}
                              {/* eslint-disable-next-line openlander-internal/no-dropped-columns */}
                              <StatusPill status={p.status} />
                            </>
                          )}
                        </div>
                        {/* Description — 1-line muted subtitle per the
                            card grid spec ("icon + title + ... + 1-line
                            subtitle"). Hidden when empty so the stats
                            strip slides up to fill the gap. */}
                        {p.description && (
                          <p className="mt-1 truncate text-[12.5px] text-[color:var(--ol-fg-muted)]">
                            {p.description}
                          </p>
                        )}
                        {/* Tags — chip row per the card grid spec
                            ("optional status pills"). Shown above the
                            stats strip; hidden entirely when no tags. */}
                        {p.tags && p.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.tags.slice(0, 6).map((tag) => (
                              <span
                                key={tag}
                                title={tag}
                                className="inline-flex max-w-[14rem] items-center truncate rounded-full border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] px-2 py-0.5 text-[10.5px] text-[color:var(--ol-fg-muted)]"
                              >
                                {tag}
                              </span>
                            ))}
                            {p.tags.length > 6 && (
                              <span className="text-[10.5px] text-[color:var(--ol-fg-subtle)]">
                                +{p.tags.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                        {/* v5 spec: stats strip is visually separated from
                            the identity row with a 1px top border, 12px
                            padding-top, and 16px gap (styles.css `.project-card-stats`). */}
                        <div className="mt-2 flex items-center gap-4 border-t border-[color:var(--ol-border-subtle)] pt-3 text-[11.5px] text-[color:var(--ol-fg-muted)]">
                          {p.serviceCount != null && (
                            <span>
                              {t(
                                p.serviceCount === 1
                                  ? 'common.count.services_one'
                                  : 'common.count.services_other',
                                { count: p.serviceCount },
                              )}
                            </span>
                          )}
                          <span>
                            {t('projects.deployedAgo', {
                              time: formatRelativeTime(p.updatedAt, t),
                            })}
                          </span>
                          <span className="ml-auto text-[color:var(--ol-fg-subtle)]">
                            {t('projects.createdAgo', {
                              time: formatRelativeTime(p.createdAt, t),
                            })}
                          </span>
                        </div>
                      </div>

                      {/* More */}
                      <button
                        type="button"
                        aria-label={t('projects.moreOptions')}
                        onClick={(e) => e.stopPropagation()}
                        className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--ol-fg-subtle)] opacity-0 transition-opacity hover:bg-[color:var(--ol-panel)] hover:text-[color:var(--ol-fg)] group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </OuterCard>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[color:var(--ol-fg)]">
                  {t('projects.create.title')}
                </h2>
                <p className="mt-1 text-[12.5px] text-[color:var(--ol-fg-muted)]">
                  {t('projects.create.description')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                aria-label={t('projects.create.closeAria')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-[color:var(--ol-fg-muted)]">
                  {t('projects.create.nameLabel')}
                </span>
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={t('projects.create.namePlaceholder')}
                  autoFocus
                  className="w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[13px] text-[color:var(--ol-fg)] outline-none transition-colors placeholder:text-[color:var(--ol-fg-subtle)] focus:border-[color:var(--ol-primary)]"
                />
              </label>

              {createError && (
                <p className="rounded-md border border-[color:var(--ol-error)]/30 bg-[color:var(--ol-error-soft)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-[color:var(--ol-border)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
                >
                  {t('projects.create.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-md bg-[color:var(--ol-primary)] px-3 py-2 text-[12.5px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? t('projects.create.submitting') : t('projects.create.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
