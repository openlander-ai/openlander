export type ManagedPublicDomainProvider = 'protected_share' | 'cloudflare';

export const PROTECTED_SHARE_MAPPING_PREFIX = 'protected-share-';

export function getManagedPublicDomainProvider(
  mappingId: string,
  connectedPublishMappingIds: ReadonlySet<string>,
): ManagedPublicDomainProvider | null {
  if (mappingId.startsWith(PROTECTED_SHARE_MAPPING_PREFIX)) {
    return 'protected_share';
  }
  return connectedPublishMappingIds.has(mappingId) ? 'cloudflare' : null;
}

export function isManagedPublicDomainMapping(
  mappingId: string,
  connectedPublishMappingIds: ReadonlySet<string>,
): boolean {
  return getManagedPublicDomainProvider(mappingId, connectedPublishMappingIds) !== null;
}
