export interface ServiceTemplate {
  id: string;
  name: string;
  image: string;
  port: number;
  versions?: string[];
}

export interface Service {
  id: string;
  name: string;
  type: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  container_id: string | null;
  container_name: string;
  port: number;
  env_vars: string | null;
  credentials: string | null;
  created_at: string;
  updated_at: string;
  summary?: {
    connectedProjects: number;
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
  };
}

export async function getServices(): Promise<Service[]> {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services');
  return res.json();
}

export async function getService(id: string): Promise<Service> {
  const res = await fetch(`/api/services/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch service: ${res.status}`);
  return res.json();
}

export async function getServiceTemplates(): Promise<ServiceTemplate[]> {
  const res = await fetch('/api/services/templates');
  if (!res.ok) throw new Error('Failed to fetch templates');
  return res.json();
}

export async function createService(opts: {
  name: string;
  template?: string;
  version?: string;
  image?: string;
  port?: number;
  env_vars?: Array<{ key: string; value: string }>;
}): Promise<Service> {
  const res = await fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: 'Failed to create service' }));
    throw new Error(data.message || 'Failed to create service');
  }
  return res.json();
}

export async function removeService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove service');
}

export async function startService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start service');
}

export async function stopService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop service');
}

export interface ServiceStats {
  status: 'running' | 'stopped' | 'error';
  diskUsageBytes: number | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
}

export interface ConnectedProject {
  id: string;
  name: string;
}

export async function getServiceStats(id: string): Promise<ServiceStats> {
  const res = await fetch(`/api/services/${id}/stats`);
  if (!res.ok) throw new Error('Failed to fetch service stats');
  return res.json();
}

export async function getConnectedProjects(id: string): Promise<ConnectedProject[]> {
  const res = await fetch(`/api/services/${id}/connected-projects`);
  if (!res.ok) throw new Error('Failed to fetch connected projects');
  return res.json();
}

export async function getServiceLogs(id: string, lines: number = 100): Promise<string> {
  const res = await fetch(`/api/services/${id}/logs?lines=${lines}`);
  if (!res.ok) throw new Error('Failed to fetch service logs');
  const data = await res.json();
  return data.logs;
}

export interface ServiceDatabase {
  name: string;
  sizeBytes: number | null;
}

export interface ServiceUser {
  name: string;
}

export async function getServiceDatabases(id: string): Promise<ServiceDatabase[]> {
  const res = await fetch(`/api/services/${id}/databases`);
  if (!res.ok) throw new Error('Failed to fetch service databases');
  const data = await res.json();
  return data.databases;
}

export async function createServiceDatabase(
  id: string,
  name: string,
): Promise<{ connectionString: string }> {
  const res = await fetch(`/api/services/${id}/databases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create service database');
  return res.json();
}

export async function getServiceUsers(id: string): Promise<ServiceUser[]> {
  const res = await fetch(`/api/services/${id}/users`);
  if (!res.ok) throw new Error('Failed to fetch service users');
  const data = await res.json();
  return data.users;
}

export async function createServiceUser(
  id: string,
  username: string,
  password?: string,
  database?: string,
): Promise<{ connectionString: string }> {
  const res = await fetch(`/api/services/${id}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, database }),
  });
  if (!res.ok) throw new Error('Failed to create service user');
  return res.json();
}
