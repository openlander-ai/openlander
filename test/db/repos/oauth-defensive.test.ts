import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { OAuthRepo } from '../../../src/db/repos/oauth.repo.js';

vi.mock('../../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('OAuthRepo — defensive getOAuthTokens (Fix 4)', () => {
  let repo: OAuthRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new OAuthRepo(db.db, db.sqlite);
    // 0009 drops parent tables; mirror src/db/index.ts:435-443 production path.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns undefined when no token exists for provider', () => {
    const result = repo.getOAuthTokens('github');
    expect(result).toBeUndefined();
  });

  it('returns stored token when it exists', () => {
    repo.upsertOAuthTokens({
      id: 'tok-1',
      provider: 'github',
      accessToken: 'ghs_abc123',
      refreshToken: null,
      expiresAt: null,
      tokenType: 'bearer',
      authMethod: 'oauth',
      userEmail: 'user@example.com',
    });

    const result = repo.getOAuthTokens('github');
    expect(result).toBeDefined();
    expect(result?.provider).toBe('github');
    expect(result?.access_token).toBe('ghs_abc123');
    expect(result?.auth_method).toBe('oauth');
  });

  it('returns undefined instead of throwing when DB query fails with schema mismatch (no such column)', () => {
    const originalSelect = repo['db'].select.bind(repo['db']);
    repo['db'].select = vi.fn().mockImplementation(() => {
      throw new Error('SqliteError: no such column: auth_method');
    });

    expect(() => repo.getOAuthTokens('github')).not.toThrow();
    const result = repo.getOAuthTokens('github');
    expect(result).toBeUndefined();

    repo['db'].select = originalSelect;
  });

  it('returns undefined when DB query fails with missing table error (no such table)', () => {
    const originalSelect = repo['db'].select.bind(repo['db']);
    repo['db'].select = vi.fn().mockImplementation(() => {
      throw new Error('SqliteError: no such table: oauth_tokens');
    });

    expect(() => repo.getOAuthTokens('github')).not.toThrow();

    repo['db'].select = originalSelect;
  });

  it('RETHROWS non-schema errors so real corruption is not silently hidden', () => {
    // Major 4: previous version swallowed ALL errors. Per critic review,
    // schema-mismatch/missing-table should be swallowed (user can run
    // migrations to fix) but other errors (disk full, IO error, lock
    // timeout, prepared-statement cache race) must bubble so operators
    // see them instead of a permanent "GitHub auth required" banner.
    const originalSelect = repo['db'].select.bind(repo['db']);
    repo['db'].select = vi.fn().mockImplementation(() => {
      throw new Error('SqliteError: database is locked');
    });

    expect(() => repo.getOAuthTokens('github')).toThrow(/database is locked/);

    repo['db'].select = originalSelect;
  });

  it('RETHROWS unrelated TypeError (programmer error) — should not be hidden', () => {
    const originalSelect = repo['db'].select.bind(repo['db']);
    repo['db'].select = vi.fn().mockImplementation(() => {
      throw new TypeError('Cannot read properties of undefined (reading "where")');
    });

    expect(() => repo.getOAuthTokens('github')).toThrow(TypeError);

    repo['db'].select = originalSelect;
  });

  it('upserts and retrieves token with all fields', () => {
    const now = new Date().toISOString();
    repo.upsertOAuthTokens({
      id: 'tok-2',
      provider: 'gitlab',
      accessToken: 'glpat-xyz',
      refreshToken: 'refresh-tok',
      expiresAt: now,
      tokenType: 'bearer',
      authMethod: 'oauth',
      userEmail: 'dev@example.com',
      iv: 'iv-value',
    });

    const result = repo.getOAuthTokens('gitlab');
    expect(result?.provider).toBe('gitlab');
    expect(result?.refresh_token).toBe('refresh-tok');
    expect(result?.user_email).toBe('dev@example.com');
  });
});
