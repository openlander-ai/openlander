import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from './service-ids.js';

/**
 * Target Identity Resolver (pre-v0.2 refactor target #1).
 *
 * One internal boundary that OWNS the legacy `<projectId>__svc` deployable-id
 * convention (see {@link projectIdToDeployableServiceId} in `service-ids.ts`).
 * Callers stop deriving the id by hand and go through here, so exactly one
 * module knows the convention.
 *
 * D1 (DECIDED 2026-06-03 in internal doc 06): **derivation-behind-interface for
 * 0.1.x.** The resolver keeps the suffix derivation internal — NO new persisted
 * canonical-deployable-id column in 0.1.x (that would be data-model-freeze-gated:
 * vocab review + endpoint-collision grep + debt ledger). A persisted column is
 * deferred and only revisited if derivation proves insufficient.
 *
 * D3: the resolver must cover the **response path**, not only mutation paths, or
 * the synthetic `service_id` derived in the `building`/`failed` responses leaks
 * to MCP clients for unresolved targets. {@link deployableServiceIdForResponse}
 * is the single guard those builders call: it returns the canonical id for a
 * **resolved** runtime project, and `undefined` (never a synthetic id) when the
 * target is unresolved, so a missing/empty target degrades to "omit the field"
 * rather than emitting a fabricated id.
 */
export class TargetIdentityResolver {
  /**
   * Canonical deployable service id for a runtime project that has (or, in the
   * deploy-success path, has just acquired) a concrete workload. Use at attach /
   * env-resolution / tunnel sites where the caller already holds a real runtime
   * project id. Behavior-identical to the previous inline
   * `projectIdToDeployableServiceId(runtimeProjectId)`.
   */
  deployableServiceIdForRuntimeProject(runtimeProjectId: string): string {
    return projectIdToDeployableServiceId(runtimeProjectId);
  }

  /**
   * Response-builder guard (D3). Given an optional runtime project id from an
   * execute-plan result, return the canonical deployable id to surface to the
   * client, or `undefined` when there is no resolved target. The previous inline
   * derivation was only reached behind a truthy `project_id` check at every call
   * site; centralizing the null-guard here means a future unresolved target can
   * never leak a synthetic `<projectId>__svc` id to clients — it simply omits the
   * `service_id` field.
   */
  deployableServiceIdForResponse(runtimeProjectId: string | undefined): string | undefined {
    if (!runtimeProjectId) {
      return undefined;
    }
    return projectIdToDeployableServiceId(runtimeProjectId);
  }

  /** Inverse: the runtime project id backing a canonical deployable service id. */
  runtimeProjectIdForDeployableService(serviceId: string): string {
    return deployableServiceIdToProjectId(serviceId);
  }
}

/** Shared singleton — the resolver is stateless, so one instance is enough. */
export const targetIdentityResolver = new TargetIdentityResolver();
