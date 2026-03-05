/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth flows.
 *
 * Extracted from CLI OAuth for reuse in web context.
 */
import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate PKCE code verifier and challenge.
 * Uses SHA256 with S256 challenge method.
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}
