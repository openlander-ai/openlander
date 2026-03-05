/**
 * Shim for `bun:sqlite` when running under Node.js (vitest).
 * Wraps `better-sqlite3` with Bun-compatible API surface.
 */
import BetterSqlite3 from 'better-sqlite3';

export class Database {
  private _db: BetterSqlite3.Database;

  constructor(path: string, _options?: { create?: boolean }) {
    this._db = new BetterSqlite3(path);
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  run(sql: string): { changes: number; lastInsertRowid: number } {
    const result = this._db.exec(sql);
    return { changes: 0, lastInsertRowid: 0 };
  }

  prepare(sql: string) {
    return this._db.prepare(sql);
  }

  close(): void {
    this._db.close();
  }

  transaction<T>(fn: (...args: unknown[]) => T) {
    return this._db.transaction(fn);
  }
}
