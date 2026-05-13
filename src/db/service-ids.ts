const DEPLOYABLE_SERVICE_SUFFIX = '__svc';

/**
 * Synthetic project group that owns managed services before they are attached
 * to a user project group. This row is hidden from project lists.
 */
export const ORPHAN_MANAGED_GROUP_ID = '__orphan_managed';

export function projectIdToDeployableServiceId(projectId: string): string {
  return projectId.endsWith(DEPLOYABLE_SERVICE_SUFFIX)
    ? projectId
    : `${projectId}${DEPLOYABLE_SERVICE_SUFFIX}`;
}

export function deployableServiceIdToProjectId(serviceId: string): string {
  return serviceId.endsWith(DEPLOYABLE_SERVICE_SUFFIX)
    ? serviceId.slice(0, -DEPLOYABLE_SERVICE_SUFFIX.length)
    : serviceId;
}
