import { asc, count, desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { chatHistory } from '../schema.drizzle.js';
import type { ChatHistoryRow } from '../types.js';

export class ChatRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  saveChatMessage(msg: {
    id: string;
    sessionId: string;
    role: ChatHistoryRow['role'];
    content: string;
    toolCalls?: unknown;
  }): void {
    this.db
      .insert(chatHistory)
      .values({
        id: msg.id,
        session_id: msg.sessionId,
        role: msg.role,
        content: msg.content,
        tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      })
      .run();
  }

  getChatHistory(sessionId: string, limit = 50): ChatHistoryRow[] {
    return this.db
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.session_id, sessionId))
      .orderBy(asc(chatHistory.created_at))
      .limit(limit)
      .all() as ChatHistoryRow[];
  }

  listChatSessions(): Array<{
    session_id: string;
    message_count: number;
    last_message: string;
    first_message: string | null;
  }> {
    return this.db
      .select({
        session_id: chatHistory.session_id,
        message_count: count(),
        last_message: sql<string>`max(${chatHistory.created_at})`,
        first_message: sql<
          string | null
        >`(SELECT ch2."content" FROM "chat_history" ch2 WHERE ch2."session_id" = "chat_history"."session_id" AND ch2."role" = 'user' ORDER BY ch2."created_at" ASC LIMIT 1)`,
      })
      .from(chatHistory)
      .groupBy(chatHistory.session_id)
      .orderBy(desc(sql`max(${chatHistory.created_at})`))
      .all() as Array<{
      session_id: string;
      message_count: number;
      last_message: string;
      first_message: string | null;
    }>;
  }

  deleteSession(sessionId: string): void {
    this.db.delete(chatHistory).where(eq(chatHistory.session_id, sessionId)).run();
  }
}
