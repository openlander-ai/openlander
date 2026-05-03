import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { migrationSqlPath, splitMigrationStatements } from './postgres-migration-helpers.js';

describe('Migration 0002: managed service source cleanup', () => {
  it('normalizes image-backed non-deployable services to source=image without touching git/compose services', () => {
    const sql = readFileSync(migrationSqlPath('0002_managed_service_source_cleanup'), 'utf8');
    const statements = splitMigrationStatements(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('UPDATE "services"');
    expect(statements[0]).toContain('SET "source" = \'image\'');
    expect(statements[0]).toContain('"image_url" IS NOT NULL');
    expect(statements[0]).toContain('"repo_url" IS NULL');
    expect(statements[0]).toContain('"source" <> \'image\'');
    expect(statements[0]).toContain('"kind" NOT IN (\'git\', \'compose\', \'compose-child\')');
  });
});
