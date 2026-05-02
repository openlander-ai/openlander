import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');
export const JOURNAL_PATH = path.join(DRIZZLE_DIR, 'meta', '_journal.json');

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export type StaticTableShape = Map<string, Set<string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') {
    throw new TypeError(`Expected ${key} to be a number`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new TypeError(`Expected ${key} to be a boolean`);
  }
  return value;
}

export function readMigrationJournal(): MigrationJournal {
  const parsed: unknown = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));
  if (!isRecord(parsed)) {
    throw new TypeError('Expected Drizzle journal to be an object');
  }

  const rawEntries = parsed.entries;
  if (!Array.isArray(rawEntries)) {
    throw new TypeError('Expected Drizzle journal entries to be an array');
  }

  const entries = rawEntries.map((entry) => {
    if (!isRecord(entry)) {
      throw new TypeError('Expected Drizzle journal entry to be an object');
    }

    return {
      idx: requireNumber(entry, 'idx'),
      version: requireString(entry, 'version'),
      when: requireNumber(entry, 'when'),
      tag: requireString(entry, 'tag'),
      breakpoints: requireBoolean(entry, 'breakpoints'),
    };
  });

  return {
    version: requireString(parsed, 'version'),
    dialect: requireString(parsed, 'dialect'),
    entries,
  };
}

export function activeMigrationSqlFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((entry) => entry.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

export function migrationSqlPath(tag: string): string {
  return path.join(DRIZZLE_DIR, `${tag}.sql`);
}

export function readMigrationSqlInJournalOrder(): string {
  return readMigrationJournal()
    .entries.map((entry) => readFileSync(migrationSqlPath(entry.tag), 'utf8'))
    .join('\n--> statement-breakpoint\n');
}

export function splitMigrationStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function staticTableShapeFromSql(sql: string): StaticTableShape {
  const shape: StaticTableShape = new Map();

  for (const statement of splitMigrationStatements(sql)) {
    applyCreateTableStatement(shape, statement);
    applyAlterAddColumnStatement(shape, statement);
    applyAlterDropColumnStatement(shape, statement);
  }

  return shape;
}

function applyCreateTableStatement(shape: StaticTableShape, statement: string): void {
  const createTable = /^CREATE TABLE\s+"([^"]+)"\s+\(([\s\S]*)\)\s*;?$/i.exec(statement);
  if (!createTable) {
    return;
  }

  const tableName = createTable[1]!;
  const body = createTable[2]!;
  const columns = new Set<string>();

  for (const rawLine of body.split('\n')) {
    const column = /^\s*"([^"]+)"\s+/.exec(rawLine);
    if (column) {
      columns.add(column[1]!);
    }
  }

  shape.set(tableName, columns);
}

function applyAlterAddColumnStatement(shape: StaticTableShape, statement: string): void {
  const addColumn = /^ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"/i.exec(statement);
  if (!addColumn) {
    return;
  }

  const tableName = addColumn[1]!;
  const columnName = addColumn[2]!;
  const columns = shape.get(tableName) ?? new Set<string>();
  columns.add(columnName);
  shape.set(tableName, columns);
}

function applyAlterDropColumnStatement(shape: StaticTableShape, statement: string): void {
  const dropColumn = /^ALTER TABLE\s+"([^"]+)"\s+DROP COLUMN\s+"([^"]+)"/i.exec(statement);
  if (!dropColumn) {
    return;
  }

  shape.get(dropColumn[1]!)?.delete(dropColumn[2]!);
}

export function quotedIdentifiers(segment: string): string[] {
  return [...segment.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}
