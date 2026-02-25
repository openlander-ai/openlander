export type ProjectVisibility = 'internal' | 'quick-share' | 'production';

export type DeployTrigger = 'chat' | 'webhook' | 'api';

export interface ProjectConfig {
  repoUrl: string;
  branch?: string;
  name?: string;
  envVars?: Record<string, string>;
  visibility?: ProjectVisibility;
  sshKeyPath?: string;
  trigger?: DeployTrigger;
  _projectId?: string;
}

export interface DeployResult {
  success: boolean;
  projectId: string;
  projectName: string;
  containerId?: string;
  url?: string;
  publicUrl?: string;
  port?: number;
  commitSha?: string;
  buildDurationMs?: number;
  error?: string;
}

export interface MonorepoConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha: string;
  dockerfiles: string[];
  envVars?: Record<string, string>;
  visibility?: ProjectVisibility;
  trigger?: DeployTrigger;
  _parentId?: string;
}

export interface MonorepoResult {
  success: boolean;
  parentProjectId: string;
  parentName: string;
  children: DeployResult[];
  buildDurationMs: number;
}

export interface StartDeployResult {
  projectId: string;
  projectName: string;
  status: 'building';
}

export interface StartMonorepoResult {
  parentProjectId: string;
  parentName: string;
  status: 'building';
}
