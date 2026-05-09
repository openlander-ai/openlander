import { fetchWithAuth } from './auth';

async function handleError(res: Response, fallbackMessage: string): Promise<never> {
  const error = await res.text().catch(() => '');
  throw new Error(error || fallbackMessage);
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) await handleError(res, `GET ${url} failed`);
  return res.json();
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const options: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetchWithAuth(url, options);
  if (!res.ok) await handleError(res, `POST ${url} failed`);
  return res.json();
}

export async function apiPostVoid(url: string, body?: unknown): Promise<void> {
  const options: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetchWithAuth(url, options);
  if (!res.ok) await handleError(res, `POST ${url} failed`);
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleError(res, `PUT ${url} failed`);
  return res.json();
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleError(res, `PATCH ${url} failed`);
  return res.json();
}

export async function apiDelete(url: string): Promise<void> {
  const res = await fetchWithAuth(url, { method: 'DELETE' });
  if (!res.ok) await handleError(res, `DELETE ${url} failed`);
}
