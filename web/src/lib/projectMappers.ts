/**
 * Map backend Project shape → V2 prototype ProjectSummary shape.
 *
 * The backend Project carries different fields (id/name/status/repo_url/
 * environments) than the V2 prototype's ProjectSummary (initials/color/
 * description/lastDeploy). This module computes/defaults the missing
 * fields so V2 components can keep their type contract while consuming
 * real data.
 *
 * When the backend grows fields like `description`, `display_color`, or
 * `last_deploy_at`, retire the synthesized branches here and pass the
 * real values through.
 */
import type { Project } from '@/types';
import type { ProjectWithOptionalEnvironments } from '@/lib/api/projects';
import type { ProjectSummary } from '@/lib/projectTopology';

const COLOR_PALETTE = [
  'oklch(0.55 0.18 255)', // indigo
  'oklch(0.62 0.16 145)', // emerald
  'oklch(0.62 0.16 30)', // orange
  'oklch(0.6 0.16 320)', // magenta
  'oklch(0.6 0.18 235)', // azure
  'oklch(0.65 0.16 90)', // amber
];

/** Stable color pick from project id — same project always gets the same color. */
function colorFor(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

/** First two characters (uppercase) of the project name; falls back to "·" */
function initialsFor(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return '·';
  if (trimmed.length === 1) return trimmed.toUpperCase();
  // Pick the first two non-whitespace, non-dash characters.
  const stripped = trimmed.replace(/[\s-_]/g, '');
  return (stripped.slice(0, 2) || trimmed.slice(0, 2)).toUpperCase();
}

/** Best-effort relative-time string. The backend may eventually return this. */
function lastDeployFor(project: Project | ProjectWithOptionalEnvironments): string {
  // Prefer the latest environment's updated_at if present.
  const envs = (project as ProjectWithOptionalEnvironments).environments ?? [];
  let latest = 0;
  for (const e of envs) {
    const t = Date.parse(e.updatedAt ?? '');
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  if (latest === 0) return '—';
  const diffMs = Date.now() - latest;
  // Defensive: clock skew or future-dated backend timestamps would
  // otherwise produce things like "-3m ago". Treat any non-positive
  // delta as "Just now" rather than displaying gibberish.
  if (diffMs <= 0) return 'Just now';
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}

/** Best-effort created-at display. */
function createdAtFor(project: Project): string {
  const t = Date.parse(project.createdAt ?? '');
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function toProjectSummary(p: ProjectWithOptionalEnvironments): ProjectSummary {
  return {
    id: p.id,
    slug: p.id,
    name: p.name,
    description: p.repoUrl ?? '',
    initials: initialsFor(p.name),
    color: colorFor(p.id),
    lastDeploy: lastDeployFor(p),
    createdAt: createdAtFor(p),
  };
}

export function toProjectSummaries(ps: ProjectWithOptionalEnvironments[]): ProjectSummary[] {
  return ps.map(toProjectSummary);
}
