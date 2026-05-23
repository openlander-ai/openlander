import { ServiceSourceMissingError } from '../errors.js';

interface RedeploySourceFields {
  id: string;
  source?: string | null;
  repo_url?: string | null;
  image_url?: string | null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getRedeploySourceMissingError(
  service: RedeploySourceFields,
): ServiceSourceMissingError | undefined {
  const source = service.source ?? 'git';
  if (source === 'image') {
    return hasText(service.image_url)
      ? undefined
      : new ServiceSourceMissingError(service.id, 'image_url', 'image');
  }

  return hasText(service.repo_url)
    ? undefined
    : new ServiceSourceMissingError(service.id, 'repo_url', source);
}
