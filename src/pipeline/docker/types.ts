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
  aliases?: string[];
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
  resourceLimits?: ResourceLimitConfig;
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
  aliases?: string[];
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

// ─── Resource Profiles ──────────────────────────────────────────────────────

export type ResourceProfileName = 'micro' | 'small' | 'medium' | 'large';

export interface ResourceProfile {
  memoryLimitBytes: number;
  memoryReservationBytes: number; // 50% of limit
  memorySwapBytes: number; // = limit (swap disabled)
  cpuShares: number; // relative weight, NOT hard cap
}

export interface ResourceLimitConfig {
  profile: ResourceProfileName | 'custom';
  memoryLimitBytes: number;
  memoryReservationBytes: number;
  memorySwapBytes: number;
  cpuShares: number;
}

export const RESOURCE_PROFILES: Record<ResourceProfileName, ResourceProfile> = {
  micro: {
    memoryLimitBytes: 268435456, // 256MB
    memoryReservationBytes: 134217728, // 128MB
    memorySwapBytes: 268435456, // = limit (no swap)
    cpuShares: 256,
  },
  small: {
    memoryLimitBytes: 536870912, // 512MB
    memoryReservationBytes: 268435456, // 256MB
    memorySwapBytes: 536870912, // = limit (no swap)
    cpuShares: 512,
  },
  medium: {
    memoryLimitBytes: 1073741824, // 1GB
    memoryReservationBytes: 536870912, // 512MB
    memorySwapBytes: 1073741824, // = limit (no swap)
    cpuShares: 1024,
  },
  large: {
    memoryLimitBytes: 2147483648, // 2GB
    memoryReservationBytes: 1073741824, // 1GB
    memorySwapBytes: 2147483648, // = limit (no swap)
    cpuShares: 2048,
  },
};

export const DEFAULT_RESOURCE_PROFILE: ResourceProfileName = 'small';

/**
 * Parse a memory string like "512m", "1g", "256m" into bytes.
 * Supports: m/mb (megabytes), g/gb (gigabytes), b (bytes)
 */
export function parseMemoryString(str: string): number {
  const lower = str.toLowerCase().trim();
  const match = lower.match(/^(\d+(?:\.\d+)?)\s*(b|kb|m|mb|g|gb)?$/);
  if (!match) throw new Error(`Invalid memory string: "${str}"`);
  const value = parseFloat(match[1] ?? '0');
  const unit = match[2] ?? 'b';
  switch (unit) {
    case 'b':
      return Math.floor(value);
    case 'kb':
      return Math.floor(value * 1024);
    case 'm':
    case 'mb':
      return Math.floor(value * 1024 * 1024);
    case 'g':
    case 'gb':
      return Math.floor(value * 1024 * 1024 * 1024);
    default:
      throw new Error(`Unknown unit: "${unit}"`);
  }
}

/**
 * Build a ResourceLimitConfig from a profile name and optional custom memory.
 * Returns null if profile is null/undefined (no limit).
 */
export function buildResourceLimitConfig(
  profile: ResourceProfileName | 'custom' | null | undefined,
  memoryLimitBytes?: number | null,
): ResourceLimitConfig | null {
  if (!profile) return null;
  if (profile === 'custom') {
    if (!memoryLimitBytes) return null;
    return {
      profile: 'custom',
      memoryLimitBytes,
      memoryReservationBytes: Math.floor(memoryLimitBytes * 0.5),
      memorySwapBytes: memoryLimitBytes,
      cpuShares: RESOURCE_PROFILES.small.cpuShares, // default cpuShares for custom
    };
  }
  return { profile, ...RESOURCE_PROFILES[profile] };
}

/**
 * Minimal shape of `docker stats` per-container output used by the four call
 * sites (monitoring tool, two compat stats endpoints, topology read-model) that
 * previously inlined the same literal type cast on `getContainerStats()`.
 */
export interface ContainerStatsRaw {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
  memory_stats: { usage: number; limit: number };
}
