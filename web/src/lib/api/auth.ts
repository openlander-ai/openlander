async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401 && !url.includes('/auth/')) {
    window.location.href = '/login';
    return new Promise(() => {});
  }

  return res;
}

export async function login(password: string): Promise<void> {
  const res = await fetchWithAuth('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to login');
  }
}

export async function logout(): Promise<void> {
  const res = await fetchWithAuth('/api/auth/logout', {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to logout');
  }
}

export async function verifySession(): Promise<{ authenticated: boolean }> {
  const res = await fetchWithAuth('/api/auth/verify');

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to verify session');
  }

  return res.json();
}

export async function setupPassword(password: string): Promise<{ apiToken: string }> {
  const res = await fetchWithAuth('/api/auth/setup-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to setup password');
  }

  return res.json();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchWithAuth('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to change password');
  }
}

export async function getApiToken(): Promise<{ token: string }> {
  const res = await fetchWithAuth('/api/auth/token');

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to get API token');
  }

  return res.json();
}

export async function regenerateApiToken(): Promise<{ token: string }> {
  const res = await fetchWithAuth('/api/auth/token/regenerate', {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to regenerate API token');
  }

  return res.json();
}
