import { desc } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { mcpSessionLog } from '../schema.drizzle.js';
import type { McpSessionLogRow } from '../schema.drizzle.js';

export class McpSessionLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  /** Append one row when a session closes. */
  recordClose(opts: {
    sessionId: string;
    transport: 'http' | 'sse';
    connectedAt: number;
    disconnectedAt: number;
    clientInfo?: string | null;
  }): void {
    this.db
      .insert(mcpSessionLog)
      .values({
        id: crypto.randomUUID(),
        session_id: opts.sessionId,
        transport: opts.transport,
        connected_at: opts.connectedAt,
        disconnected_at: opts.disconnectedAt,
        client_info: opts.clientInfo ?? null,
      })
      .run();
  }

  /**
   * Recent closed sessions ordered by disconnect time desc. Used by the v4
   * /api/activity feed to synthesize mcp_disconnected events.
   */
  listRecentClosed(limit = 50): McpSessionLogRow[] {
    return this.db
      .select()
      .from(mcpSessionLog)
      .orderBy(desc(mcpSessionLog.disconnected_at))
      .limit(limit)
      .all() as McpSessionLogRow[];
  }
}
