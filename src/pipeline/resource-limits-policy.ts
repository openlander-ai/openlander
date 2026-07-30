import os from 'node:os';

import type { DeployConfigSnapshot } from './config-snapshot.js';
import { RESOURCE_PROFILES } from './docker/types.js';

export const RESOURCE_PROFILE_NAMES = ['micro', 'small', 'medium', 'large', 'custom'] as const;

export type ResourceProfileSelection = (typeof RESOURCE_PROFILE_NAMES)[number];

export function isResourceProfileSelection(value: unknown): value is ResourceProfileSelection {
  return (
    typeof value === 'string' && RESOURCE_PROFILE_NAMES.some((profileName) => profileName === value)
  );
}

export interface ResourceProfileUpdate {
  profile: ResourceProfileSelection;
  memoryMb?: number;
}

export function formatMemoryBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
  return `${String(Math.floor(bytes / (1024 * 1024)))}MB`;
}

export function validateResourceProfileUpdate(
  input: ResourceProfileUpdate,
  hostTotalMemoryBytes = os.totalmem(),
): string | null {
  const maxMemoryBytes = Math.floor(hostTotalMemoryBytes * 0.8);
  const maxMemoryMb = Math.floor(maxMemoryBytes / 1024 / 1024);

  if (input.profile === 'custom') {
    if (input.memoryMb === undefined) {
      return 'memory is required when the resource profile is "custom"';
    }
    if (!Number.isInteger(input.memoryMb) || input.memoryMb < 64) {
      return 'custom memory must be an integer of at least 64MB';
    }
    if (input.memoryMb > maxMemoryMb) {
      return `custom memory (${String(input.memoryMb)}MB) exceeds maximum allowed (${String(maxMemoryMb)}MB, 80% of host memory)`;
    }
    return null;
  }

  if (input.memoryMb !== undefined) {
    return 'custom memory can only be set with the "custom" resource profile';
  }

  const profileMemoryBytes = RESOURCE_PROFILES[input.profile].memoryLimitBytes;
  if (profileMemoryBytes > maxMemoryBytes) {
    return `Profile "${input.profile}" requires ${formatMemoryBytes(profileMemoryBytes)} but host allows max ${formatMemoryBytes(maxMemoryBytes)} (80% of host memory)`;
  }
  return null;
}

export function applyResourceProfileUpdate(
  snapshot: DeployConfigSnapshot,
  input: ResourceProfileUpdate,
): DeployConfigSnapshot {
  if (input.profile === 'custom') {
    return {
      ...snapshot,
      resourceProfile: 'custom',
      memoryLimitBytes: (input.memoryMb ?? 0) * 1024 * 1024,
    };
  }

  return {
    ...snapshot,
    resourceProfile: input.profile,
    memoryLimitBytes: RESOURCE_PROFILES[input.profile].memoryLimitBytes,
  };
}

export function resourceMemoryMb(snapshot: DeployConfigSnapshot): number | null {
  if (!snapshot.resourceProfile) return null;
  const bytes =
    snapshot.resourceProfile === 'custom'
      ? snapshot.memoryLimitBytes
      : RESOURCE_PROFILES[snapshot.resourceProfile].memoryLimitBytes;
  return bytes ? Math.floor(bytes / 1024 / 1024) : null;
}
