import { apiDelete, apiGet, apiPost } from './client';

export type GitCredentialStatus = 'pending' | 'verified' | 'failed';

export interface GitCredentialServiceUsage {
  service_id: string;
  service_name: string;
  project_id: string;
}

export interface GitCredentialSummary {
  id: string;
  name: string;
  fingerprint: string;
  status: GitCredentialStatus;
}

export interface GitCredential extends GitCredentialSummary {
  provider: 'github';
  auth_type: 'deploy_key';
  repository_url: string;
  repository_key: string;
  public_key: string;
  default_branch: string | null;
  last_error_code: string | null;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  github_setup_url: string;
  usage_count: number;
  services: GitCredentialServiceUsage[];
}

export async function listGitCredentials(
  filters: {
    repoUrl?: string;
    status?: GitCredentialStatus;
  } = {},
): Promise<GitCredential[]> {
  const query = new URLSearchParams();
  if (filters.repoUrl) query.set('repo_url', filters.repoUrl);
  if (filters.status) query.set('status', filters.status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await apiGet<{ credentials: GitCredential[] }>(`/api/git-credentials${suffix}`);
  return response.credentials;
}

export async function createGitCredential(input: {
  repoUrl: string;
  name?: string;
}): Promise<GitCredential> {
  const response = await apiPost<{ credential: GitCredential }>('/api/git-credentials', {
    repo_url: input.repoUrl,
    name: input.name,
  });
  return response.credential;
}

export async function verifyGitCredential(id: string): Promise<GitCredential> {
  const response = await apiPost<{ credential: GitCredential }>(
    `/api/git-credentials/${encodeURIComponent(id)}/verify`,
  );
  return response.credential;
}

export async function removeGitCredential(id: string): Promise<void> {
  await apiDelete(`/api/git-credentials/${encodeURIComponent(id)}`);
}
