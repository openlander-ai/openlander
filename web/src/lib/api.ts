import type { Project, SystemStats, DeployResult } from '../types';

export async function deployProject(repoUrl: string, branch?: string, name?: string): Promise<DeployResult> {
  const res = await fetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch, name }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to deploy project');
  }
  return res.json();
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    throw new Error('Failed to fetch projects');
  }
  const data = await res.json();
  return data.projects;
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`);
  return res.json();
}

export async function stopProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/stop`, { method: 'POST' });
}

export async function redeployProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/redeploy`, { method: 'POST' });
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function getProjectLogs(id: string): Promise<string> {
  const res = await fetch(`/api/projects/${id}/logs`);
  return res.text();
}

export async function getProjectEnv(id: string): Promise<Record<string, string>> {
  const res = await fetch(`/api/projects/${id}/env`);
  return res.json();
}

export async function updateProjectEnv(id: string, env: Record<string, string>): Promise<void> {
  await fetch(`/api/projects/${id}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(env),
  });
}

export async function exposeProject(id: string): Promise<{ publicUrl: string }> {
  const res = await fetch(`/api/projects/${id}/expose`, { method: 'POST' });
  if (!res.ok) {
    throw new Error('Failed to expose project');
  }
  return res.json();
}

export async function unexposeProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/unexpose`, { method: 'POST' });
}

export async function getSystemStats(): Promise<SystemStats> {
  const res = await fetch('/api/system/stats');
  return res.json();
}

export interface SetupStatus {
  ready: boolean;
  docker: { ok: boolean; message: string };
  traefik: { ok: boolean; message: string };
  llm: { ok: boolean; provider: string; model: string; message: string };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/setup/status');
  if (!res.ok) throw new Error('Failed to fetch setup status');
  return res.json();
}

export async function configureLLM(provider: string, apiKey: string, model?: string): Promise<any> {
  const res = await fetch('/api/setup/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey, model }),
  });
  if (!res.ok) throw new Error('Failed to configure LLM');
  return res.json();
}

export async function startTraefik(): Promise<any> {
  const res = await fetch('/api/setup/traefik', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Traefik');
  return res.json();
}

export async function completeSetup(): Promise<any> {
  const res = await fetch('/api/setup/complete', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to complete setup');
  return res.json();
}
