import { apiGet, apiPost, apiPostVoid } from './client';

export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401 && !url.includes('/auth/')) {
    window.location.href = '/login';
    return new Promise(() => {});
  }

  return res;
}

export async function login(password: string): Promise<void> {
  await apiPostVoid('/api/auth/login', { password });
}

export async function logout(): Promise<void> {
  await apiPostVoid('/api/auth/logout');
}

export async function verifySession(): Promise<{ authenticated: boolean }> {
  return apiGet<{ authenticated: boolean }>('/api/auth/verify');
}

export async function setupPassword(password: string): Promise<{ apiToken: string }> {
  return apiPost<{ apiToken: string }>('/api/auth/setup-password', { password });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiPostVoid('/api/auth/change-password', { currentPassword, newPassword });
}

export async function getApiToken(): Promise<{ token: string }> {
  return apiGet<{ token: string }>('/api/auth/token');
}

export async function regenerateApiToken(): Promise<{ token: string }> {
  return apiPost<{ token: string }>('/api/auth/token/regenerate');
}

export async function startGoogleOAuth(): Promise<void> {
  // Navigate to backend start endpoint
  window.location.href = '/api/auth/google/start';
}

export async function getGoogleAuthStatus(): Promise<{ connected: boolean; email?: string }> {
  try {
    const response = await fetchWithAuth('/api/auth/google/status');
    if (!response.ok) return { connected: false };
    return response.json();
  } catch {
    return { connected: false };
  }
}
