import { cloneRepo } from '../git.js';

export interface CloneStepConfig {
  repoUrl: string;
  branch?: string;
  sshKeyPath?: string;
}

export interface CloneStepResult {
  path: string;
  commitSha: string;
}

export async function executeCloneStep(config: CloneStepConfig): Promise<CloneStepResult> {
  return cloneRepo({
    repoUrl: config.repoUrl,
    branch: config.branch,
    sshKeyPath: config.sshKeyPath,
  });
}
