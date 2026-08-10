export const OFFICIAL_CLOUDFLARE_OAUTH_CLIENT_ID = '29e7e4779ca6bd3a39c0ce05ba538451';

export const OFFICIAL_CLOUDFLARE_OAUTH_REDIRECT_URI =
  'https://openlander.dongbin.cloud/cloudflare-oauth-callback';

export const OFFICIAL_CLOUDFLARE_OAUTH_SCOPES = [
  'dns.write',
  'zone.read',
  'teams-connectors.write',
  'account-settings.read',
] as const;

export function parseCloudflareOAuthScopes(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
