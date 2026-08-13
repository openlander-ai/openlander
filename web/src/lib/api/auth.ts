import { apiGet, apiPatch, apiPost, apiPostVoid } from './client';

export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401 && !url.includes('/auth/')) {
    window.location.href = '/login';
    return new Promise(() => {});
  }

  return res;
}

export async function login(password: string): Promise<void> {
  await apiPostVoid('/api/auth/login', { password });
}

export async function logout(): Promise<void> {
  await apiPostVoid('/api/auth/logout');
}

export async function verifySession(): Promise<{ authenticated: boolean }> {
  return apiGet<{ authenticated: boolean }>('/api/auth/verify');
}

export async function setupPassword(password: string): Promise<{ apiToken: string }> {
  return apiPost<{ apiToken: string }>('/api/auth/setup-password', { password });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiPostVoid('/api/auth/change-password', { currentPassword, newPassword });
}

export async function getApiToken(): Promise<{ token: string }> {
  return apiGet<{ token: string }>('/api/auth/token');
}

export async function regenerateApiToken(): Promise<{ token: string }> {
  return apiPost<{ token: string }>('/api/auth/token/regenerate');
}

export interface ActiveMcpScope {
  activeScope:
    | { kind: 'org' }
    | { kind: 'project'; projectId: string; projectName: string; displayName: string };
}

export async function getActiveMcpScope(): Promise<ActiveMcpScope> {
  return apiGet<ActiveMcpScope>('/api/session/scope');
}

export async function setActiveMcpScope(projectId: string | null): Promise<ActiveMcpScope> {
  return apiPost<ActiveMcpScope>('/api/session/scope', { project_id: projectId });
}

export interface McpPatTokenMetadata {
  id: string;
  name: string;
  suffix: string;
  scope: {
    kind: 'org' | 'project' | 'service';
    projectId: string | null;
    serviceId: string | null;
  };
  tokenType: 'pat' | 'service' | 'legacy-default';
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface McpInstanceInfo {
  id: string;
  name: string;
  suggestedName: string;
  endpoint: string;
  host: string;
  isDefaultName: boolean;
}

/**
 * v0.1 single-token MCP endpoints (PR #235). The frontend's "Your
 * Agent" page and setup wizard talk to these instead of composing
 * `/api/tokens` list/issue/revoke calls — the backend now owns the
 * single-token invariant (duplicate cleanup, legacy-default rotation,
 * issue/rotate atomicity) so the client doesn't have to fake it.
 */

/** GET /api/mcp/token — the active org MCP token metadata, or null. */
export async function getOrgMcpToken(): Promise<{ token: McpPatTokenMetadata | null }> {
  return apiGet<{ token: McpPatTokenMetadata | null }>('/api/mcp/token');
}

export interface RevealOrgMcpTokenResult {
  token: McpPatTokenMetadata;
  plaintext: string;
}

export async function revealOrgMcpToken(): Promise<RevealOrgMcpTokenResult> {
  return apiPost<RevealOrgMcpTokenResult>('/api/mcp/token/reveal');
}

export async function getMcpInstance(): Promise<McpInstanceInfo> {
  return apiGet<McpInstanceInfo>('/api/mcp/instance');
}

export async function updateMcpInstanceName(name: string): Promise<McpInstanceInfo> {
  return apiPatch<McpInstanceInfo>('/api/mcp/instance', { name });
}

export interface OrgMcpTokenIssueResult {
  /** Always present — the keeper row metadata. */
  token: McpPatTokenMetadata;
  /**
   * The fresh plaintext, returned on initial issuance and on rotate.
   * Existing tokens are revealed through the explicit session-only
   * reveal endpoint instead of being included in metadata reads.
   */
  plaintext: string | null;
  /** True when this call minted a new token; false when one was reused. */
  created: boolean;
  /** Old PAT IDs the backend revoked (duplicates / rotated tokens). */
  revokedTokenIds: string[];
  /** True if a legacy-default token row was rotated as part of the call. */
  legacyTokenRotated: boolean;
}

export interface IssueOrgMcpTokenInput {
  name?: string;
  expiresInDays?: number;
}

/**
 * POST /api/mcp/token — ensure an active org MCP PAT exists.
 *   - No active token → mint a fresh one (`created: true`, plaintext set)
 *   - Active token already present → reuse it, dedupe stragglers
 *     (`created: false`, plaintext null)
 */
export async function ensureOrgMcpToken(
  input?: IssueOrgMcpTokenInput,
): Promise<OrgMcpTokenIssueResult> {
  return apiPost<OrgMcpTokenIssueResult>('/api/mcp/token', {
    name: input?.name,
    expires_in_days: input?.expiresInDays,
  });
}

/**
 * POST /api/mcp/token/regenerate — atomically revoke every active org
 * token (including legacy-default rows) and issue a fresh one. Always
 * returns plaintext.
 */
export async function regenerateOrgMcpToken(
  input?: IssueOrgMcpTokenInput,
): Promise<OrgMcpTokenIssueResult> {
  return apiPost<OrgMcpTokenIssueResult>('/api/mcp/token/regenerate', {
    name: input?.name,
    expires_in_days: input?.expiresInDays,
  });
}

export async function startGoogleOAuth(): Promise<void> {
  // Navigate to backend start endpoint
  window.location.href = '/api/auth/google/start';
}

export async function getGoogleAuthStatus(): Promise<{ connected: boolean; email?: string }> {
  try {
    const response = await fetchWithAuth('/api/auth/google/status');
    if (!response.ok) return { connected: false };
    return response.json();
  } catch {
    return { connected: false };
  }
}
