export type DockerStatus =
  | { state: 'running' }
  | { state: 'not_installed' }
  | { state: 'not_running' }
  | { state: 'permission_denied'; groupFixed?: boolean };

export interface SecretFileMount {
  filename: string;
  content: string;
  mountPath: string;
}

export interface RunContainerOptions {
  imageTag: string;
  name: string;
  port: number;
  containerPort?: number;
  envVars: Record<string, string>;
  cmd?: string[];
  traefikLabels: Record<string, string>;
  network?: string;
  secretFiles?: SecretFileMount[];
  restartPolicy?: { Name: string; MaximumRetryCount?: number };
  extraBinds?: string[];
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  labels?: Record<string, string>;
}

export interface RunComposeServiceOptions {
  imageTag: string;
  name: string;
  port: number;
  containerPort?: number;
  envVars: Record<string, string>;
  traefikLabels: Record<string, string>;
  secretFiles?: SecretFileMount[];
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  network?: string;
  networks?: string[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  port?: number;
  imageTag?: string;
  labels?: Record<string, string>;
}

export interface PortInfo {
  IP?: string;
  PrivatePort?: number;
  PublicPort?: number;
  Type?: string;
}

export interface AllContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: PortInfo[];
  labels: Record<string, string>;
  managedByOpenLander: boolean;
  composeProject: string | null;
  created: number;
}

export interface BuildImageOptions {
  noCache?: boolean;
  buildArgs?: Record<string, string>;
  target?: string;
  dockerfile?: string;
  onProgress?: (event: { stream?: string; error?: string }) => void;
  projectId?: string;
}

export interface BuildComposeServiceOptions {
  contextPath: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: Record<string, string>;
  target?: string;
  noCache?: boolean;
  cacheFrom?: string[];
  onProgress?: (event: { stream?: string; error?: string }) => void;
}

export interface WaitForHealthyResult {
  healthy: boolean;
  exitCode?: number;
  error?: string;
}
