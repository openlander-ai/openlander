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
 */
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../errors.js';
import type { ProjectRow } from '../db/index.js';

/**
 * Minimal context required by `assertProjectMutable`. Implemented by both
 * `AppContext` (web routes) and `DeployPipeline` (pipeline boundary), so
 * the policy can be shared without coupling to either type.
 */
export interface MutationPolicyCtx {
  db: { isCircuitBreakerOpen: (projectId: string) => boolean };
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
  if (project.status === 'recovering') {
    throw new ProjectRecoveringError(project.id);
  }
  if (ctx.db.isCircuitBreakerOpen(project.id)) {
    throw new CircuitBreakerOpenError(project.id);
  }
}
