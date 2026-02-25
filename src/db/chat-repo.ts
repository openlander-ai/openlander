import { BaseRepository } from './base-repo.js';
import type { ChatHistoryRow } from './types.js';

export interface SaveChatMessageInput {
  id: string;
  sessionId: string;
  role: ChatHistoryRow['role'];
  content: string;
  toolCalls?: unknown;
}

export interface ChatSessionSummary {
  session_id: string;
  message_count: number;
  last_message: string;
}

export class ChatHistoryRepository extends BaseRepository {
  saveChatMessage(msg: SaveChatMessageInput): void {
    this.db
      .prepare(
        `INSERT INTO chat_history (id, session_id, role, content, tool_calls)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      );
  }

  getChatHistory(sessionId: string, limit = 50): ChatHistoryRow[] {
    return this.db
      .prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(sessionId, limit) as ChatHistoryRow[];
  }

  listChatSessions(): ChatSessionSummary[] {
    return this.db
      .prepare(
        `SELECT session_id, COUNT(*) as message_count, MAX(created_at) as last_message
         FROM chat_history
         GROUP BY session_id
         ORDER BY last_message DESC`,
      )
      .all() as ChatSessionSummary[];
  }
}
