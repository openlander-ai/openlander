import { fetchWithAuth } from './auth';

interface ApiErrorPayload {
  code?: string;
  error?: string;
  message?: string;
  details?: unknown;
}

const STABLE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly payload?: ApiErrorPayload;

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    const candidateCode = payload?.code ?? payload?.error;
    this.code = candidateCode && STABLE_ERROR_CODE.test(candidateCode) ? candidateCode : undefined;
    this.details = payload?.details;
    this.payload = payload;
  }
}

function parseApiErrorPayload(text: string): ApiErrorPayload | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const payload = parsed as Record<string, unknown>;
    return {
      code: typeof payload.code === 'string' ? payload.code : undefined,
      error: typeof payload.error === 'string' ? payload.error : undefined,
      message: typeof payload.message === 'string' ? payload.message : undefined,
      details: payload.details,
    };
  } catch {
    return undefined;
  }
}

export async function throwApiError(res: Response, fallbackMessage: string): Promise<never> {
  const text = await res.text().catch(() => '');
  const payload = parseApiErrorPayload(text);
  const message = (payload?.message ?? payload?.error ?? text) || fallbackMessage;
  throw new ApiError(message, res.status, payload);
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) await throwApiError(res, `GET ${url} failed`);
  return res.json();
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const options: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetchWithAuth(url, options);
  if (!res.ok) await throwApiError(res, `POST ${url} failed`);
  return res.json();
}

export async function apiPostVoid(url: string, body?: unknown): Promise<void> {
  const options: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetchWithAuth(url, options);
  if (!res.ok) await throwApiError(res, `POST ${url} failed`);
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, `PUT ${url} failed`);
  return res.json();
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, `PATCH ${url} failed`);
  return res.json();
}

export async function apiDelete(url: string): Promise<void> {
  const res = await fetchWithAuth(url, { method: 'DELETE' });
  if (!res.ok) await throwApiError(res, `DELETE ${url} failed`);
}

export async function apiDeleteWithBody<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, `DELETE ${url} failed`);
  return res.json();
}
