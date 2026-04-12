import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer, type RingBufferEntry } from '../../src/lib/ring-buffer.js';

describe('RingBuffer', () => {
  let buffer: RingBuffer<string>;

  beforeEach(() => {
    buffer = new RingBuffer<string>();
  });

  it('should push and retrieve items in order', () => {
    buffer.push('a');
    buffer.push('b');
    buffer.push('c');

    const recent = buffer.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].data).toBe('b');
    expect(recent[1].data).toBe('c');
  });

  it('should evict oldest items when capacity is exceeded', () => {
    const smallBuffer = new RingBuffer<string>(3);
    smallBuffer.push('a');
    smallBuffer.push('b');
    smallBuffer.push('c');
    smallBuffer.push('d');
    smallBuffer.push('e');

    const all = smallBuffer.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].data).toBe('c');
    expect(all[1].data).toBe('d');
    expect(all[2].data).toBe('e');
  });

  it('should return empty array when buffer is empty', () => {
    const recent = buffer.getRecent(5);
    expect(recent).toEqual([]);
    expect(buffer.size).toBe(0);
  });

  it('should support time-filtered retrieval with since parameter', () => {
    buffer.push('a');
    const cutoff = Date.now();
    // Small delay to ensure timestamp difference
    const start = Date.now();
    while (Date.now() === start) {
      // Spin until time advances
    }
    buffer.push('b');
    buffer.push('c');

    const filtered = buffer.getRecent(10, { since: cutoff });
    expect(filtered.length).toBeGreaterThanOrEqual(2);
    expect(filtered[filtered.length - 2].data).toBe('b');
    expect(filtered[filtered.length - 1].data).toBe('c');
  });

  it('should clear all items', () => {
    buffer.push('a');
    buffer.push('b');
    buffer.push('c');
    expect(buffer.size).toBe(3);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });

  it('should validate capacity is greater than 0', () => {
    expect(() => new RingBuffer<string>(0)).toThrow();
    expect(() => new RingBuffer<string>(-1)).toThrow();
  });

  it('should return all items in chronological order', () => {
    buffer.push('first');
    buffer.push('second');
    buffer.push('third');

    const all = buffer.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].data).toBe('first');
    expect(all[1].data).toBe('second');
    expect(all[2].data).toBe('third');
  });

  it('should have default capacity of 1000', () => {
    expect(buffer.capacity).toBe(1000);
  });

  it('should wrap data with timestamp automatically', () => {
    const before = Date.now();
    buffer.push('test');
    const after = Date.now();

    const entries = buffer.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].data).toBe('test');
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(entries[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('should handle getRecent with n larger than size', () => {
    buffer.push('a');
    buffer.push('b');

    const recent = buffer.getRecent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].data).toBe('a');
    expect(recent[1].data).toBe('b');
  });

  it('should handle getRecent with n = 0', () => {
    buffer.push('a');
    buffer.push('b');

    const recent = buffer.getRecent(0);
    expect(recent).toEqual([]);
  });
});
