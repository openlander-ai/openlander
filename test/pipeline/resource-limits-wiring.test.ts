import { describe, it, expect, vi } from 'vitest';
import {
  loadResourceLimitsForDeployTarget,
  loadResourceLimitsForProject,
  loadResourceLimitsForService,
} from '../../src/pipeline/config-snapshot.js';
import type { Database } from '../../src/db/index.js';
import { serializeConfig } from '../../src/pipeline/config-snapshot.js';

describe('loadResourceLimitsForProject', () => {
  it('returns null when no config row exists', async () => {
    const db = { loadDeployConfig: vi.fn().mockResolvedValue(null) } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns null when config row has null snapshot', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: JSON.stringify({ version: 1, snapshot: null }),
      }),
    } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns null when snapshot has no resourceProfile', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ environment: 'production' }),
      }),
    } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).toBeNull();
  });

  it('returns correct config for small profile', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'small' }),
      }),
    } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('small');
    expect(result!.memoryLimitBytes).toBe(536870912);
    expect(result!.memorySwapBytes).toBe(536870912);
    expect(result!.cpuShares).toBe(512);
  });

  it('returns correct config for medium profile', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'medium' }),
      }),
    } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('medium');
    expect(result!.memoryLimitBytes).toBe(1073741824);
    expect(result!.cpuShares).toBe(1024);
  });

  it('returns correct config for custom profile with memoryLimitBytes', async () => {
    const customBytes = 768 * 1024 * 1024;
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'custom', memoryLimitBytes: customBytes }),
      }),
    } as unknown as Database;
    const result = await loadResourceLimitsForProject(db, 'proj-123');
    expect(result).not.toBeNull();
    expect(result!.profile).toBe('custom');
    expect(result!.memoryLimitBytes).toBe(customBytes);
    expect(result!.memoryReservationBytes).toBe(Math.floor(customBytes * 0.5));
  });

  it('passes the projectId to loadDeployConfig', async () => {
    const mockLoadDeployConfig = vi.fn().mockResolvedValue(null);
    const db = { loadDeployConfig: mockLoadDeployConfig } as unknown as Database;
    await loadResourceLimitsForProject(db, 'specific-project-id');
    expect(mockLoadDeployConfig).toHaveBeenCalledWith('specific-project-id');
  });
});

describe('loadResourceLimitsForService', () => {
  it('passes the serviceId to loadDeployConfigForService', async () => {
    const mockLoadDeployConfigForService = vi.fn().mockResolvedValue(null);
    const db = {
      loadDeployConfigForService: mockLoadDeployConfigForService,
    } as unknown as Database;

    await loadResourceLimitsForService(db, 'svc-123');

    expect(mockLoadDeployConfigForService).toHaveBeenCalledWith('svc-123');
  });
});

describe('loadResourceLimitsForDeployTarget', () => {
  it('prefers service-scoped deploy config when serviceId is available', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'small' }),
      }),
      loadDeployConfigForService: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'large' }),
      }),
    } as unknown as Database;

    const result = await loadResourceLimitsForDeployTarget(db, {
      projectId: 'proj-123',
      serviceId: 'svc-123',
    });

    expect(result?.profile).toBe('large');
    expect(db.loadDeployConfigForService).toHaveBeenCalledWith('svc-123');
    expect(db.loadDeployConfig).not.toHaveBeenCalled();
  });

  it('falls back to project-scoped deploy config when serviceId is missing', async () => {
    const db = {
      loadDeployConfig: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'small' }),
      }),
      loadDeployConfigForService: vi.fn().mockResolvedValue({
        config_json: serializeConfig({ resourceProfile: 'large' }),
      }),
    } as unknown as Database;

    const result = await loadResourceLimitsForDeployTarget(db, {
      projectId: 'proj-123',
    });

    expect(result?.profile).toBe('small');
    expect(db.loadDeployConfig).toHaveBeenCalledWith('proj-123');
    expect(db.loadDeployConfigForService).not.toHaveBeenCalled();
  });
});
