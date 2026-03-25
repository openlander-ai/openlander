/**
 * Authentication type definitions.
 *
 * Defines interfaces and types for auth sessions, state, setup status, and database records.
 */

export type AuthSession = {
  token: string;
  createdAt: number;
  expiresAt: number;
};

export type AuthState = 'no-password' | 'needs-login' | 'authenticated';

export type SetupStatusResponse = {
  ready: boolean;
  dockerOk: boolean;
  docker: {
    ok: boolean;
    message: string;
    state?: string;
  };
  traefikOk: boolean;
  traefik: {
    ok: boolean;
  };
  hasPassword: boolean;
  llmConfigured: boolean;
  github?: {
    ok: boolean;
    username?: string;
  };
  llm?: {
    ok: boolean;
    provider?: string;
  };
  setupComplete: boolean;
};

export type AuthRow = {
  id: number;
  password_hash: string;
  api_token: string;
  api_token_iv: string | null;
  session_token: string | null;
  session_created_at: number | null;
  session_expires_at: number | null;
};
