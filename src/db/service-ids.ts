const DEPLOYABLE_SERVICE_SUFFIX = '__svc';

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
