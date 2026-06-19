const USER_OWNED_PREFIXES = ['EXCHANGE_', 'STRIPE_', 'SMTP_', 'S3_'] as const;

function hostFromTarget(target: string | null | undefined): string | null {
  if (!target) return null;
  try {
    return new URL(target).hostname || null;
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  );
}

function isSingleLabelHost(host: string): boolean {
  return !host.includes('.') && !host.includes(':');
}

function isOpenLanderManagedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'ol-svc' || normalized.startsWith('ol-svc-');
}

function isCandidateExternalEnvKey(key: string): boolean {
  const normalized = key.trim().toUpperCase();
  if (normalized.length === 0) return false;
  if (USER_OWNED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized === 'DATABASE_URL' || normalized === 'REDIS_URL') return true;
  return /(?:^|_)(?:URL|URI|ENDPOINT|API_URL|API_KEY)$/.test(normalized);
}

export function isUserOwnedExternalEnvDependency(input: {
  key: string | null | undefined;
  target?: string | null;
  host?: string | null;
}): boolean {
  const key = input.key?.trim();
  if (!key || !isCandidateExternalEnvKey(key)) return false;

  const host = (input.host ?? hostFromTarget(input.target))?.trim();
  if (!host) return false;
  if (isOpenLanderManagedHost(host) || isLoopbackHost(host)) return false;

  // Single-label hosts are usually Docker/network aliases. Avoid creating a
  // mutation gate unless the dependency is clearly external.
  return !isSingleLabelHost(host);
}
