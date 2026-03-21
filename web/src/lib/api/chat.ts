import type { ChatMessage, ChatSession, QuestionAnswer } from '../chat-types.js';

export async function streamChat(
  message: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
    signal,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to start chat stream');
  }
  return res;
}

export async function replyQuestion(requestId: string, answers: QuestionAnswer[]): Promise<void> {
  const res = await fetch('/api/question/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, answers }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to reply to question');
  }
}

export async function dismissQuestion(): Promise<void> {
  const res = await fetch('/api/question/dismiss', { method: 'POST' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to dismiss question');
  }
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) {
    throw new Error('Failed to fetch chat sessions');
  }
  const data = (await res.json()) as { sessions: ChatSession[] };
  return data.sessions;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`);
  if (!res.ok) {
    throw new Error('Failed to fetch session messages');
  }
  const data = (await res.json()) as { messages: ChatMessage[] };
  return data.messages;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to delete chat session');
  }
}
