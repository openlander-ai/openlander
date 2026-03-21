import { nanoid } from 'nanoid';
import type { Database, ChatHistoryRow } from '../db/index.js';

/**
 * Tool call information stored with chat messages.
 */
export interface ToolCallInfo {
  toolName: string;
  success: boolean;
}

/**
 * Session information returned by listSessions.
 */
export interface SessionInfo {
  sessionId: string;
  messageCount: number;
  lastActive: string;
}

/**
 * SessionStore manages chat history persistence.
 *
 * Wraps the Database chat history methods with a cleaner API
 * for use by the API routes.
 */
export class SessionStore {
  constructor(private db: Database) {}

  /**
   * Add a message to a chat session.
   * Creates a new session if one doesn't exist.
   */
  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: ToolCallInfo[],
  ): void {
    this.db.saveChatMessage({
      id: nanoid(12),
      sessionId,
      role,
      content,
      toolCalls,
    });
  }

  /**
   * Get messages for a session, ordered chronologically.
   * @param limit Maximum number of messages to return (default 50)
   */
  getMessages(sessionId: string, limit?: number): ChatHistoryRow[] {
    return this.db.getChatHistory(sessionId, limit ?? 50);
  }

  /**
   * List all chat sessions with metadata.
   */
  listSessions(): SessionInfo[] {
    const rows = this.db.listChatSessions();
    return rows.map((row) => ({
      sessionId: row.session_id,
      messageCount: row.message_count,
      lastActive: row.last_message,
    }));
  }

  /**
   * Delete all messages for a session.
   * Does not throw if the session doesn't exist.
   */
  deleteSession(sessionId: string): void {
    this.db.deleteSession(sessionId);
  }

  /**
   * Extract username from a session ID.
   * Session IDs follow the format: "username-timestamp"
   * where timestamp is a numeric string (Date.now()).
   */
  static extractUsername(sessionId: string): string {
    const parts = sessionId.split('-');
    const lastPart = parts[parts.length - 1];
    if (parts.length > 1 && lastPart && /^\d+$/.test(lastPart)) {
      return parts.slice(0, -1).join('-');
    }
    return sessionId;
  }
}
