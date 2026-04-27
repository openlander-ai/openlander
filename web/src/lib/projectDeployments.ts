/**
 * Mock deployment history per service.
 *
 * Replace with `useDeployments(projectId, serviceId)` backend hook when
 * the deployment-list endpoint lands.
 */

export type DeployStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type Trigger = 'mcp' | 'webhook' | 'manual';

export interface DeploymentRecord {
  id: number;
  status: DeployStatus;
  commit: string;
  message: string;
  trigger: Trigger;
  triggerLabel: string;
  branch: string;
  /** Display string e.g. "1m 40s" — null if still running */
  duration: string | null;
  /** Display string e.g. "Just now" / "12m ago" */
  started: string;
  /** Error class id when status === 'failed' */
  errorClass?: string;
}

export const MOCK_DEPLOYMENTS: DeploymentRecord[] = [
  {
    id: 7,
    status: 'running',
    commit: '7af3c12',
    message: 'fix: env_file loading for prod compose',
    trigger: 'mcp',
    triggerLabel: 'MCP agent',
    branch: 'main',
    duration: null,
    started: 'Just now',
  },
  {
    id: 6,
    status: 'failed',
    commit: '9d0a44e',
    message: 'feat(api): add seed CLI',
    trigger: 'webhook',
    triggerLabel: 'Git push',
    branch: 'main',
    duration: '1m 40s',
    started: '12m ago',
    errorClass: 'BUILD_CONTEXT_MISMATCH',
  },
  {
    id: 5,
    status: 'done',
    commit: '55f2b81',
    message: 'chore: bump pg base image to 16.4',
    trigger: 'manual',
    triggerLabel: 'Manual',
    branch: 'main',
    duration: '3m 12s',
    started: '1h ago',
  },
  {
    id: 4,
    status: 'failed',
    commit: '210ccf1',
    message: 'wip: try multi-stage api Dockerfile',
    trigger: 'webhook',
    triggerLabel: 'Git push',
    branch: 'feat/multistage',
    duration: '2m 51s',
    started: '3h ago',
    errorClass: 'IMAGE_WRONG_STAGE',
  },
  {
    id: 3,
    status: 'done',
    commit: 'f018a2c',
    message: 'feat: ingest dealmoa source',
    trigger: 'mcp',
    triggerLabel: 'MCP agent',
    branch: 'main',
    duration: '2m 48s',
    started: '5h ago',
  },
  {
    id: 2,
    status: 'cancelled',
    commit: '881efe4',
    message: 'experiment: nixpacks',
    trigger: 'manual',
    triggerLabel: 'Manual',
    branch: 'main',
    duration: '0m 22s',
    started: 'Yesterday',
  },
  {
    id: 1,
    status: 'done',
    commit: '401abc9',
    message: 'initial deploy',
    trigger: 'manual',
    triggerLabel: 'Manual',
    branch: 'main',
    duration: '4m 03s',
    started: 'Apr 21',
  },
];
