import type BetterSqlite3Type from 'better-sqlite3';

export class BaseRepository {
  constructor(protected readonly db: BetterSqlite3Type.Database) {}

  protected transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
