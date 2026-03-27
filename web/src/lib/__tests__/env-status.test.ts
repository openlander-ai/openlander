import { describe, it, expect } from 'vitest';
import { getAggregatedEnvStatus } from '../env-status';

describe('getAggregatedEnvStatus', () => {
  it('returns stopped for empty array', () => {
    const result = getAggregatedEnvStatus([]);
    expect(result).toBe('stopped');
  });

  it('returns the status of a single running environment', () => {
    const result = getAggregatedEnvStatus([{ status: 'running' }]);
    expect(result).toBe('running');
  });

  it('returns the status of a single error environment', () => {
    const result = getAggregatedEnvStatus([{ status: 'error' }]);
    expect(result).toBe('error');
  });

  it('returns error when mixed with running environments', () => {
    const result = getAggregatedEnvStatus([
      { status: 'running' },
      { status: 'error' },
      { status: 'running' },
    ]);
    expect(result).toBe('error');
  });

  it('returns building when mixed with running environments', () => {
    const result = getAggregatedEnvStatus([{ status: 'running' }, { status: 'building' }]);
    expect(result).toBe('building');
  });

  it('returns stopped when all environments are stopped', () => {
    const result = getAggregatedEnvStatus([
      { status: 'stopped' },
      { status: 'stopped' },
      { status: 'stopped' },
    ]);
    expect(result).toBe('stopped');
  });

  it('returns idle when mixed with stopped environments', () => {
    const result = getAggregatedEnvStatus([
      { status: 'stopped' },
      { status: 'idle' },
      { status: 'stopped' },
    ]);
    expect(result).toBe('idle');
  });

  it('handles environments with undefined status as stopped', () => {
    const result = getAggregatedEnvStatus([
      { status: 'running' },
      { status: undefined },
      { status: 'running' },
    ]);
    expect(result).toBe('running');
  });

  it('handles environments with missing status property as stopped', () => {
    const result = getAggregatedEnvStatus([{ status: 'running' }, {}, { status: 'running' }]);
    expect(result).toBe('running');
  });

  it('respects priority order: error > building > running > idle > stopped', () => {
    const result = getAggregatedEnvStatus([
      { status: 'stopped' },
      { status: 'idle' },
      { status: 'running' },
      { status: 'building' },
      { status: 'error' },
    ]);
    expect(result).toBe('error');
  });

  it('handles unknown status gracefully', () => {
    const result = getAggregatedEnvStatus([
      { status: 'running' },
      { status: 'unknown' as unknown as string },
    ]);
    expect(result).toBe('running');
  });

  it('returns running when all environments are running', () => {
    const result = getAggregatedEnvStatus([
      { status: 'running' },
      { status: 'running' },
      { status: 'running' },
    ]);
    expect(result).toBe('running');
  });

  it('returns building when mixed with idle and stopped', () => {
    const result = getAggregatedEnvStatus([
      { status: 'stopped' },
      { status: 'idle' },
      { status: 'building' },
    ]);
    expect(result).toBe('building');
  });
});
