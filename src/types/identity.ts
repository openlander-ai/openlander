/**
 * RequestIdentity — tracks who/how triggered an AI action.
 *
 * All fields are optional in Phase 1. They will always be null/undefined
 * until multi-tenant auth is implemented in a future phase.
 *
 * source: The technical entry point (how the request arrived)
 * initiatedBy/userId: The accountable owner (who is responsible)
 *   - For auto-recovery: the project owner's userId
 *   - For MCP: the authenticated MCP client user
 */
export interface RequestIdentity {
  userId?: string; // Accountable owner for audit purposes
  tenantId?: string; // Team/organization scope (for future multi-tenancy)
  role?: string; // 'admin' | 'member' | 'viewer' (future use)
  source: 'web' | 'mcp' | 'auto-recovery' | 'monitor'; // Technical entry point
  initiatedBy?: string; // Human-readable requester (distinct from source)
  /** v5.1 MCP PAT metadata. Legacy single-token auth is represented as org scope. */
  mcpTokenId?: string | null;
  mcpTokenType?: 'legacy-default' | 'pat' | 'service';
  mcpScopeKind?: 'org' | 'project';
  mcpScopeProjectId?: string | null;
}
