import type { QuestionAnswer } from '../chat-types.js';

export async function streamChat(
  message: string,
  signal?: AbortSignal,
  projectId?: string,
): Promise<Response> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(projectId ? { projectId } : {}) }),
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
