export const OPENLANDER_URL =
  process.env.OPENLANDER_E2E_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:10114';

export function authHeaders(): Record<string, string> {
  if (process.env.OPENLANDER_API_TOKEN) {
    return { Authorization: `Bearer ${process.env.OPENLANDER_API_TOKEN}` };
  }
  if (process.env.OPENLANDER_SESSION) {
    return { Cookie: `ol_session=${process.env.OPENLANDER_SESSION}` };
  }
  return {};
}

export function isNoAuthMode(): boolean {
  return process.env.OPENLANDER_E2E_NO_AUTH === '1';
}
