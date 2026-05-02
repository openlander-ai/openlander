import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { mcpSessionLog } from '../schema.drizzle.js';
import type { McpSessionLogRow } from '../schema.drizzle.js';

export class McpSessionLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /** Append one row when a session closes. */
  async recordClose(opts: {
    sessionId: string;
    transport: 'http' | 'sse';
    connectedAt: number;
    disconnectedAt: number;
    clientInfo?: string | null;
  }): Promise<void> {
    await this.db.insert(mcpSessionLog).values({
      id: randomUUID(),
      session_id: opts.sessionId,
      transport: opts.transport,
      connected_at: opts.connectedAt,
      disconnected_at: opts.disconnectedAt,
      client_info: opts.clientInfo ?? null,
    });
  }

  /**
   * Recent closed sessions ordered by disconnect time desc. Used by the v4
   * /api/activity feed to synthesize mcp_disconnected events.
   */
  async listRecentClosed(limit = 50): Promise<McpSessionLogRow[]> {
    return this.db
      .select()
      .from(mcpSessionLog)
      .orderBy(desc(mcpSessionLog.disconnected_at))
      .limit(limit);
  }
}
