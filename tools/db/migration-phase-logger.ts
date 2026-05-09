/**
 * Migration phase logger — emits structured log events at each
 * `--> statement-breakpoint` boundary while the 0012 migration runs.
 *
 * Plan §"PR 5 Boot-log instrumentation": 8 markers
 * `[migrate:0012] phase A complete` ... `phase H complete` are emitted in
 * order so the boot-log test (test/db/migration-0012-boot-log.test.ts) can
 * assert ordering and the soak-grep CI gate has unambiguous phase markers
 * to anchor against in production logs.
 *
 * Strategy: detect the boundary statements (we tag each phase by the
 * leading SQL keywords that uniquely identify the phase entry point) and
 * emit a single `[migrate:0012] phase X complete` line after each phase's
 * last statement runs successfully. The wrapper does NOT replace Drizzle's
 * own migrator; it runs ALONGSIDE it as a pre-pass that streams the SQL
 * statements directly through the same sqlite handle so we can interleave
 * log emission with statement execution.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Database as SqliteDb } from 'better-sqlite3';
import { createModuleLogger } from '../../src/lib/logger.js';

const log = createModuleLogger('migrate-0012');

/** Phase letters in execution order — used both for log emission and
 * the boot-log test's order assertion. */
export const MIGRATION_0012_PHASES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type Migration0012Phase = (typeof MIGRATION_0012_PHASES)[number];

/**
 * Phase boundary detection. Each phase opens with a marker comment in the
 * 0012 SQL (`-- Phase A —`, `-- Phase B —`, ...). When the loop encounters
 * the start of phase N+1, it emits `phase N complete`. After the loop ends,
 * the final phase's `complete` marker fires.
 */
const PHASE_HEADER_RE = /^--\s*=+\s*$\s*--\s*Phase\s+([A-H])\b/im;

interface ParsedSql {
  /** Raw statement text. */
  text: string;
  /** Phase this statement belongs to, derived from the most recent header. */
  phase: Migration0012Phase;
}

export function parseMigration0012(sqlPath: string): ParsedSql[] {
  if (!existsSync(sqlPath)) {
    throw new Error(`Migration file not found: ${sqlPath}`);
  }
  const raw = readFileSync(sqlPath, 'utf8');
  // Split by statement-breakpoint, then assign each chunk to a phase based
  // on the most recent `-- Phase X —` header seen.
  const chunks = raw.split('--> statement-breakpoint');
  const out: ParsedSql[] = [];
  let currentPhase: Migration0012Phase = 'A';
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const headerMatch = PHASE_HEADER_RE.exec(chunk);
    if (headerMatch?.[1]) {
      currentPhase = headerMatch[1] as Migration0012Phase;
    }
    out.push({ text: trimmed, phase: currentPhase });
  }
  return out;
}

/**
 * Apply migration 0012 with phase logging. Returns the list of phases that
 * emitted a `complete` marker (8 if the migration ran end-to-end).
 *
 * The caller is responsible for the surrounding transaction + foreign-keys
 * gate (production: src/db/index.ts:448-456). This helper only iterates
 * statements + emits log events.
 */
export function runMigration0012WithPhaseLogging(
  sqlite: SqliteDb,
  migrationsFolder: string,
): Migration0012Phase[] {
  const sqlPath = path.join(migrationsFolder, '0012_complete_schema_split.sql');
  const stmts = parseMigration0012(sqlPath);
  const completed: Migration0012Phase[] = [];

  if (stmts.length === 0) return completed;

  let activePhase: Migration0012Phase = stmts[0]!.phase;

  for (const stmt of stmts) {
    if (stmt.phase !== activePhase) {
      log.info({ phase: activePhase }, `[migrate:0012] phase ${activePhase} complete`);
      completed.push(activePhase);
      activePhase = stmt.phase;
    }
    sqlite.exec(stmt.text);
  }
  // Final phase marker.
  log.info({ phase: activePhase }, `[migrate:0012] phase ${activePhase} complete`);
  completed.push(activePhase);
  return completed;
}
