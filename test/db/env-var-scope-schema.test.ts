import { describe, expect, it } from 'vitest';

import { readMigrationSqlInJournalOrder } from './postgres-migration-helpers.js';

describe('env var scope schema', () => {
  it('uses separate partial unique indexes for shared and environment-scoped vars', () => {
    const sql = readMigrationSqlInJournalOrder();

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "env_vars_project_group_key_unique" ON "env_vars" USING btree ("project_id","key") WHERE "env_vars"."service_id" IS NULL AND "env_vars"."environment_id" IS NULL',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "env_vars_project_environment_key_unique" ON "env_vars" USING btree ("project_id","environment_id","key") WHERE "env_vars"."service_id" IS NULL AND "env_vars"."environment_id" IS NOT NULL',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "env_vars_service_key_unique" ON "env_vars" USING btree ("service_id","key") WHERE "env_vars"."service_id" IS NOT NULL AND "env_vars"."environment_id" IS NULL',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "env_vars_service_environment_key_unique" ON "env_vars" USING btree ("service_id","environment_id","key") WHERE "env_vars"."service_id" IS NOT NULL AND "env_vars"."environment_id" IS NOT NULL',
    );
  });
});
