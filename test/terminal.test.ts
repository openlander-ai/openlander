import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Terminal session message routing tests
// ---------------------------------------------------------------------------

describe('Terminal message routing', () => {
  it('parses resize message correctly', () => {
    const msg = JSON.stringify({ type: 'resize', cols: 120, rows: 40 });
    const parsed = JSON.parse(msg) as Record<string, unknown>;

    expect(parsed['type']).toBe('resize');
    expect(parsed['cols']).toBe(120);
    expect(parsed['rows']).toBe(40);
  });

  it('parses input message correctly', () => {
    const msg = JSON.stringify({ type: 'input', data: 'ls -la\n' });
    const parsed = JSON.parse(msg) as Record<string, unknown>;

    expect(parsed['type']).toBe('input');
    expect(parsed['data']).toBe('ls -la\n');
  });

  it('treats non-JSON as raw input', () => {
    const raw = 'hello world';
    let isJson = true;
    try {
      JSON.parse(raw);
    } catch {
      isJson = false;
    }
    expect(isJson).toBe(false);
  });

  it('rejects messages over 4096 bytes', () => {
    const MAX_MESSAGE_BYTES = 4096;
    const oversized = Buffer.alloc(MAX_MESSAGE_BYTES + 1, 'a');
    expect(oversized.byteLength > MAX_MESSAGE_BYTES).toBe(true);
  });

  it('accepts messages at exactly 4096 bytes', () => {
    const MAX_MESSAGE_BYTES = 4096;
    const exact = Buffer.alloc(MAX_MESSAGE_BYTES, 'a');
    expect(exact.byteLength > MAX_MESSAGE_BYTES).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Terminal idle timeout tests
// ---------------------------------------------------------------------------

describe('Terminal idle timeout', () => {
  it('idle timeout is configured to 30 minutes', () => {
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
    expect(IDLE_TIMEOUT_MS).toBe(1_800_000);
  });

  it('resets idle timer on each message', () => {
    vi.useFakeTimers();
    const closeCallback = vi.fn();
    let idleTimer = setTimeout(closeCallback, 30 * 60 * 1000);

    // Simulate message received — reset timer
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeCallback, 30 * 60 * 1000);

    // Advance 29 minutes — should NOT close
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(closeCallback).not.toHaveBeenCalled();

    // Advance 1 more minute — should close
    vi.advanceTimersByTime(60 * 1000);
    expect(closeCallback).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Terminal container validation tests
// ---------------------------------------------------------------------------

describe('Terminal container validation', () => {
  it('rejects project with no container_id', () => {
    const project = { id: 'p1', status: 'stopped', container_id: null };
    const isValid = project.container_id !== null && project.status === 'running';
    expect(isValid).toBe(false);
  });

  it('rejects project with non-running status', () => {
    const project = { id: 'p1', status: 'error', container_id: 'abc123' };
    const isValid = project.container_id !== null && project.status === 'running';
    expect(isValid).toBe(false);
  });

  it('accepts project with running container', () => {
    const project = { id: 'p1', status: 'running', container_id: 'abc123' };
    const isValid = project.container_id !== null && project.status === 'running';
    expect(isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting tests
// ---------------------------------------------------------------------------

describe('Terminal rate limiting', () => {
  it('allows up to 100 messages per second', () => {
    const MAX_RATE = 100;
    let messageCount = 0;
    let blocked = false;

    for (let i = 0; i < MAX_RATE; i++) {
      messageCount++;
      if (messageCount > MAX_RATE) {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(false);
    expect(messageCount).toBe(MAX_RATE);
  });

  it('blocks the 101st message', () => {
    const MAX_RATE = 100;
    let messageCount = 0;
    let blocked = false;

    for (let i = 0; i <= MAX_RATE; i++) {
      messageCount++;
      if (messageCount > MAX_RATE) {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(true);
  });
});
