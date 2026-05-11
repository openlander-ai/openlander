import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  normalizeDomainHost,
  normalizeDomainPathPrefix,
} from '../../src/db/repos/domain-mapping.repo.js';
import { migrationSqlPath } from './postgres-migration-helpers.js';

describe('domain mapping route schema', () => {
  it('includes route columns in the v0.1 baseline schema', () => {
    const sql = readFileSync(migrationSqlPath('0000_v0_1_initial'), 'utf8');

    expect(sql).toContain('CREATE TABLE "domain_mappings"');
    expect(sql).toContain('"path_prefix" text DEFAULT \'/\' NOT NULL');
    expect(sql).toContain('"strip_prefix" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('"upstream_path_prefix" text');
    expect(sql).toContain('"target_port" integer');
    expect(sql).toContain('"tls_enabled" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('"tls_resolver" text');
    expect(sql).toContain('"updated_at" text DEFAULT now()::text');
  });

  it('uses domain plus path prefix uniqueness in the v0.1 baseline', () => {
    const sql = readFileSync(migrationSqlPath('0000_v0_1_initial'), 'utf8');

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "domain_mappings_domain_path_unique" ON "domain_mappings" USING btree ("domain","path_prefix")',
    );
    expect(sql).not.toContain('CREATE UNIQUE INDEX "domain_mappings_domain_unique"');
  });

  it('normalizes host and path fields for repo helpers', () => {
    expect(normalizeDomainHost(' API.Example.COM. ')).toBe('api.example.com');
    expect(normalizeDomainPathPrefix(undefined)).toBe('/');
    expect(normalizeDomainPathPrefix('')).toBe('/');
    expect(normalizeDomainPathPrefix('api')).toBe('/api');
    expect(normalizeDomainPathPrefix('/api/')).toBe('/api');
    expect(normalizeDomainPathPrefix('//api//v1//')).toBe('/api/v1');
    expect(normalizeDomainPathPrefix('/')).toBe('/');
  });
});
