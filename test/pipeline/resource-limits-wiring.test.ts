import { describe, it, expect, vi } from 'vitest';
import { loadResourceLimitsForProject } from '../../src/pipeline/config-snapshot.js';
import type { Database } from '../../src/db/index.js';
import { serializeConfig } from '../../src/pipeline/config-snapshot.js';

describe('loadResourceLimitsForProject', () => {
  it('returns null when no config row exists', () => {
    const db = { loadDeployConfig: vi.fn().mockReturnValue(null) } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns null when config row has null snapshot', () => {
    const db = {
      loadDeployConfig: vi.fn().mockReturnValue({
        config_json: JSON.stringify({ version: 1, snapshot: null }),
      }),
    } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns null when snapshot has no resourceProfile', () => {
    const db = {
      loadDeployConfig: vi.fn().mockReturnValue({
        config_json: serializeConfig({ environment: 'production' }),
      }),
    } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns correct config for small profile', () => {
    const db = {
      loadDeployConfig: vi.fn().mockReturnValue({
        config_json: serializeConfig({ resourceProfile: 'small' }),
      }),
    } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('small');
    expect(result!.memoryLimitBytes).toBe(536870912);
    expect(result!.memorySwapBytes).toBe(536870912);
    expect(result!.cpuShares).toBe(512);
  });

  it('returns correct config for medium profile', () => {
    const db = {
      loadDeployConfig: vi.fn().mockReturnValue({
        config_json: serializeConfig({ resourceProfile: 'medium' }),
      }),
    } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('medium');
    expect(result!.memoryLimitBytes).toBe(1073741824);
    expect(result!.cpuShares).toBe(1024);
  });

  it('returns correct config for custom profile with memoryLimitBytes', () => {
    const customBytes = 768 * 1024 * 1024;
    const db = {
      loadDeployConfig: vi.fn().mockReturnValue({
        config_json: serializeConfig({ resourceProfile: 'custom', memoryLimitBytes: customBytes }),
      }),
    } as unknown as Database;
    const result = loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('custom');
    expect(result!.memoryLimitBytes).toBe(customBytes);
    expect(result!.memoryReservationBytes).toBe(Math.floor(customBytes * 0.5));
  });

  it('passes the projectId to loadDeployConfig', () => {
    const mockLoadDeployConfig = vi.fn().mockReturnValue(null);
    const db = { loadDeployConfig: mockLoadDeployConfig } as unknown as Database;
    loadResourceLimitsForProject(db, 'specific-project-id');
    expect(mockLoadDeployConfig).toHaveBeenCalledWith('specific-project-id');
  });
});
