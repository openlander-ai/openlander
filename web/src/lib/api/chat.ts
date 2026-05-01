import type { QuestionAnswer } from '../chat-types.js';

export async function streamChat(
  message: string,
  signal?: AbortSignal,
  projectId?: string,
  sessionId?: string,
): Promise<Response> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      ...(projectId ? { projectId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, 'Failed to start chat stream'));
  }
  return res;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const raw = await res.text();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // not JSON — fall through to raw text
  }
  return raw;
}

export async function replyQuestion(requestId: string, answers: QuestionAnswer[]): Promise<void> {
  const res = await fetch('/api/question/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, answers }),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, 'Failed to reply to question'));
  }
}

export async function dismissQuestion(): Promise<void> {
  const res = await fetch('/api/question/dismiss', { method: 'POST' });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, 'Failed to dismiss question'));
  }
}
