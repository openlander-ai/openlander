/**
 * v4 Activity event shape — server contract for the cross-actor audit
 * timeline. Mirrored exactly by `web/src/lib/agentActivity.ts:ActivityEvent`.
 *
 * Keep these two type files in lockstep — the contract test in
 * `src/web/api/__tests__/activity-routes.contract.test.ts` will fail if they
 * drift.
 */

export type Actor = 'mcp' | 'human' | 'webhook' | 'system';

export type ActivityKind =
  | 'deploy_started'
  | 'deploy_completed'
  | 'deploy_failed'
  | 'deploy_cancelled'
  | 'config_changed'
  | 'service_crashed'
  | 'service_recovered'
  | 'mcp_connected'
  | 'mcp_disconnected';

export interface V4ActivityEvent {
  id: string;
  actor: Actor;
  kind: ActivityKind;
  /** Human-readable absolute time hint, e.g. "Just now", "12m ago", "1h ago". */
  at: string;
  /** Seconds since now — used for time-bucketing into Just now / Earlier today / Yesterday. */
  relTs: number;
  /** Project ID, or null for system-level events (e.g. mcp_connected). */
  project: string | null;
  /** Service ID within the project, or null for project-level events. */
  service: string | null;
  /** One-sentence headline. */
  title: string;
  /** One-line detail / context. NOT a paragraph. */
  detail?: string;
}
