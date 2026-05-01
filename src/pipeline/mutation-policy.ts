/**
 * Pipeline-level mutation eligibility policy.
 *
 * Centralised invariant for all mutating pipeline entry points
 * (`pipeline.deploy`, `pipeline.redeploy`, `pipeline.rollback`,
 * `pipeline.blueGreenDeploy`). The same policy used to live inline in
 * `src/web/api/project-routes.ts`; it is hoisted here so every caller
 * (web/MCP/webhook/domain/compose) is automatically protected.
 *
 * Throws a typed 409 error when a project cannot accept a mutating operation:
 * - archived → `ProjectArchivedError`
 * - recovering → `ProjectRecoveringError`
 * - circuit breaker open → `CircuitBreakerOpenError`
 *
 * The lifecycle variant `assertProjectLifecycleMutable` enforces the same
 * invariant for `start`/`stop`/`archive`/`purge` routes with action-specific
 * relaxations so operators retain an escape hatch (e.g. `stop` is allowed on
 * a recovering project so a stuck recovery loop can be broken).
 */
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../errors.js';
import type { ProjectRow, ServiceRow } from '../db/index.js';

/**
 * Minimal context required by `assertProjectMutable`. Implemented by both
 * `AppContext` (web routes) and `DeployPipeline` (pipeline boundary), so
 * the policy can be shared without coupling to either type.
 */
export interface MutationPolicyCtx {
  db: {
    isCircuitBreakerOpen: (projectId: string) => boolean;
    // PR 4.5: needed for canonical-first status reads with `??` fallback.
    getDeployableForProject: (projectId: string) => ServiceRow | undefined;
  };
}

/**
 * Throw a typed 409 error when `project` cannot accept mutating operations
 * (redeploy / rollback / blue-green / deploy). Idempotent: callers that
 * already invoked it before reaching the pipeline boundary pay only the
 * cost of one circuit-breaker lookup the second time.
 */
export function assertProjectMutable(project: ProjectRow, ctx: MutationPolicyCtx): void {
  if (project.archived_at) {
    throw new ProjectArchivedError(project.id);
  }
  // PR 4.5: canonical-first read of status with `??` fallback.
  const deployable = ctx.db.getDeployableForProject(project.id);
  const status = deployable?.status ?? project.status;
  if (status === 'recovering') {
    throw new ProjectRecoveringError(project.id);
  }
  if (ctx.db.isCircuitBreakerOpen(project.id)) {
    throw new CircuitBreakerOpenError(project.id);
  }
}

/**
 * Lifecycle action enforced by `assertProjectLifecycleMutable`.
 *
 * - `start`: bring a previously-stopped container up.
 * - `stop`: take the container down (operator escape hatch).
 * - `archive`: soft-delete (preserves history, blocks future deploys).
 * - `purge`: hard-delete (permanent removal of an archived project).
 */
export type LifecycleAction = 'start' | 'stop' | 'archive' | 'purge';

/**
 * Throw a typed 409 error when `project` cannot accept the requested
 * lifecycle action.
 *
 * Policy matrix (✅ allowed / ❌ rejected):
 *
 * | action  | archived | recovering | circuit_open |
 * | ------- | -------- | ---------- | ------------ |
 * | start   | ❌       | ❌          | ❌            |
 * | stop    | ❌       | ✅          | ✅            |
 * | archive | ❌       | ❌          | ❌            |
 * | purge   | ✅       | ❌          | ❌            |
 *
 * Rationale:
 * - `start`: bringing a project back online while archived would silently
 *   bypass the unarchive flow; while recovering would race the recovery
 *   loop; while the breaker is open would defeat the breaker.
 * - `stop`: operators must always be able to halt a project. `recovering`
 *   and `circuit_open` are explicitly allowed so a stuck recovery loop
 *   or open breaker can be broken without unarchiving first.
 * - `archive`: requires a clean state. Re-archiving an already-archived
 *   project is rejected so the operator notices the no-op; recovering /
 *   circuit_open are rejected so we don't archive mid-recovery.
 * - `purge`: only valid for archived projects, and only when no recovery
 *   or breaker activity is in flight. The route also gates on
 *   `?confirm=true` separately.
 */
export function assertProjectLifecycleMutable(
  project: ProjectRow,
  action: LifecycleAction,
  ctx: MutationPolicyCtx,
): void {
  // Archived gate — action-specific.
  if (project.archived_at && action !== 'purge') {
    throw new ProjectArchivedError(project.id);
  }

  // PR 4.5: canonical-first status read with `??` fallback.
  const deployable = ctx.db.getDeployableForProject(project.id);
  const status = deployable?.status ?? project.status;

  // Recovering gate — `stop` is the operator escape hatch.
  if (status === 'recovering' && action !== 'stop') {
    throw new ProjectRecoveringError(project.id);
  }

  // Circuit-breaker gate — `stop` is the operator escape hatch.
  if (action !== 'stop' && ctx.db.isCircuitBreakerOpen(project.id)) {
    throw new CircuitBreakerOpenError(project.id);
  }
}
