/**
 * v4 Activity event shape — server contract for the cross-actor audit
 * timeline. Mirrored exactly by `web/src/lib/agentActivity.ts:ActivityEvent`.
 *
 * Keep these two type files in lockstep. A zod-backed parity test is
 * scheduled for 1.1; until then, drift is caught by typecheck on the
 * UI hook (`web/src/hooks/use-activity-feed.ts`) which casts the
 * response payload to the UI ActivityEvent type.
 */

export type Actor = 'mcp' | 'human' | 'webhook' | 'system';

export type ActivityKind =
  | 'deploy_started'
  | 'deploy_completed'
  | 'deploy_failed'
  | 'deploy_cancelled'
  | 'config_changed'
  | 'data_access_read'
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
  /** Optional display name for the project — populated when the row is
   *  in scope at emit time. UI falls back to `project` ID when absent. */
  projectName?: string | null;
  /** Optional display name for the service — populated when the row is
   *  known. UI strips the legacy `__svc` suffix off `service` as a
   *  fallback. */
  serviceName?: string | null;
  /** One-sentence headline. */
  title: string;
  /** One-line detail / context. NOT a paragraph. */
  detail?: string;
}
