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
 * D3 (scope, honest): the top-level `service_id` on the `building`/`failed`
 * responses must not be fabricated for a target that did not resolve to a
 * runtime project. {@link deployableServiceIdForResponse} is the single
 * **null-guard** those two builders (engine `building` return +
 * `buildTargetAttachFields`) call: given a runtime project id it derives the
 * canonical `<id>__svc`, and given `undefined` it omits the field instead of
 * emitting `undefined__svc`. NOTE the bound of this guard — it is a null-guard,
 * NOT a workload-existence check: it does not query the DB to confirm a
 * deployable row exists, so a present-but-empty group still derives an id. A
 * persisted workload-existence check is out of 0.1.x scope (see D1). Diagnostic
 * `diagnostic_call` hints elsewhere still derive via
 * {@link deployableServiceIdForRuntimeProject} at points where the deploy has
 * concretely run (projectId defined) — those are contextual next-call hints, not
 * an unresolved-target leak.
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
   * Response-builder null-guard (D3). Given an optional runtime project id from
   * an execute-plan result, return the canonical deployable id to surface to the
   * client, or `undefined` when there is no runtime project. Centralizing the
   * null-guard here means an unresolved target (undefined) omits the `service_id`
   * field rather than emitting a fabricated `undefined__svc`. It does NOT assert
   * the workload exists — a defined id always derives; workload-existence
   * verification is out of 0.1.x scope (D1).
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
