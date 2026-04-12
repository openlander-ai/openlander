import { beforeEach, describe, expect, it } from 'vitest';
import { LogRingBuffer, getLogBuffer } from '../../src/lib/log-buffer.js';

describe('LogRingBuffer', () => {
  let buffer: LogRingBuffer;

  beforeEach(() => {
    buffer = new LogRingBuffer(3);
  });

  it('stores and retrieves recent entries in order', () => {
    buffer.push({ level: 30, msg: 'first', timestamp: 1000 });
    buffer.push({ level: 40, msg: 'second', timestamp: 1001, module: 'deploy' });
    buffer.push({ level: 50, msg: 'third', timestamp: 1002, module: 'health' });

    const recent = buffer.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].msg).toBe('second');
    expect(recent[1].msg).toBe('third');
  });

  it('evicts oldest entries when capacity is exceeded', () => {
    buffer.push({ level: 20, msg: 'a', timestamp: 1 });
    buffer.push({ level: 20, msg: 'b', timestamp: 2 });
    buffer.push({ level: 20, msg: 'c', timestamp: 3 });
    buffer.push({ level: 20, msg: 'd', timestamp: 4 });

    const all = buffer.getRecent(10);
    expect(all.map((entry) => entry.msg)).toEqual(['b', 'c', 'd']);
  });

  it('filters entries by minimum level', () => {
    buffer.push({ level: 20, msg: 'debug', timestamp: 1 });
    buffer.push({ level: 30, msg: 'info', timestamp: 2 });
    buffer.push({ level: 50, msg: 'error', timestamp: 3 });

    const filtered = buffer.getByLevel(40);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].msg).toBe('error');
  });

  it('filters entries by module', () => {
    buffer.push({ level: 30, msg: 'deploy start', timestamp: 1, module: 'deploy' });
    buffer.push({ level: 30, msg: 'health check', timestamp: 2, module: 'health' });
    buffer.push({ level: 30, msg: 'deploy done', timestamp: 3, module: 'deploy' });

    const moduleEntries = buffer.getByModule('deploy');
    expect(moduleEntries).toHaveLength(2);
    expect(moduleEntries.map((entry) => entry.msg)).toEqual(['deploy start', 'deploy done']);
  });

  it('tracks size and can clear entries', () => {
    expect(buffer.size).toBe(0);

    buffer.push({ level: 30, msg: 'one', timestamp: 1 });
    buffer.push({ level: 30, msg: 'two', timestamp: 2 });
    expect(buffer.size).toBe(2);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.getRecent(10)).toEqual([]);
  });
});

describe('getLogBuffer', () => {
  it('returns a singleton instance', () => {
    const first = getLogBuffer();
    const second = getLogBuffer();

    expect(first).toBe(second);
  });
});
