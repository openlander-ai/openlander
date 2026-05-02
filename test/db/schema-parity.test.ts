import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { drizzleSchema } from '../../src/db/schema.drizzle.js';
import {
  readMigrationSqlInJournalOrder,
  staticTableShapeFromSql,
  type StaticTableShape,
} from './postgres-migration-helpers.js';

function drizzleTableShape(): { duplicates: string[]; shape: StaticTableShape } {
  const duplicates: string[] = [];
  const shape: StaticTableShape = new Map();

  for (const [exportName, table] of Object.entries(drizzleSchema)) {
    const config = getTableConfig(table);
    const columns = new Set(config.columns.map((column) => column.name));

    if (shape.has(config.name)) {
      duplicates.push(`${config.name} exported more than once; latest export=${exportName}`);
    }

    shape.set(config.name, columns);
  }

  return { duplicates, shape };
}

function sortedValues(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function columnSetDiff(expected: Set<string>, actual: Set<string>): string {
  const missing = sortedValues(expected).filter((column) => !actual.has(column));
  const extra = sortedValues(actual).filter((column) => !expected.has(column));
  return `missing=[${missing.join(',')}] extra=[${extra.join(',')}]`;
}

describe('Postgres schema parity (Drizzle schema vs migration SQL)', () => {
  it('active Postgres migrations create the same table/column shape declared by Drizzle', () => {
    const drizzle = drizzleTableShape();
    const migrated = staticTableShapeFromSql(readMigrationSqlInJournalOrder());
    const mismatches: string[] = [...drizzle.duplicates];
    const allTables = new Set([...drizzle.shape.keys(), ...migrated.keys()]);

    for (const tableName of sortedValues(allTables)) {
      const declaredColumns = drizzle.shape.get(tableName);
      const migratedColumns = migrated.get(tableName);

      if (!declaredColumns) {
        mismatches.push(`Table '${tableName}' exists in migrations but not in drizzleSchema`);
        continue;
      }

      if (!migratedColumns) {
        mismatches.push(`Table '${tableName}' exists in drizzleSchema but not in migrations`);
        continue;
      }

      if (columnSetDiff(declaredColumns, migratedColumns) !== 'missing=[] extra=[]') {
        mismatches.push(
          `Table '${tableName}' column mismatch: ${columnSetDiff(declaredColumns, migratedColumns)}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
