import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { OpenLanderClient, type HealthResponse, type Project } from '../src/ipc/client.js';

// ---------------------------------------------------------------------------
// Mock node:http
// ---------------------------------------------------------------------------

vi.mock('node:http', () => ({
  request: vi.fn(),
}));

import { request } from 'node:http';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

// Helper to create a mock IncomingMessage
function createMockResponse(
  statusCode: number,
  body: string,
): { res: EventEmitter & { statusCode: number }; end: () => void } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return {
    res,
    end: () => {
      res.emit('data', Buffer.from(body));
      res.emit('end');
    },
  };
}

// Helper to create a mock request object
function createMockRequest(): {
  req: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  emitError: (err: Error) => void;
} {
  const req = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  req.write = vi.fn();
  req.end = vi.fn();
  return {
    req,
    emitError: (err: Error) => req.emit('error', err),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenLanderClient', () => {
  let client: OpenLanderClient;
  let socketPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-ipc-test-'));
    socketPath = join(tmpDir, 'daemon.sock');
    client = new OpenLanderClient(socketPath);
    mockRequest.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Constructor & isSocketPresent
  // ---------------------------------------------------------------------------

  it('stores socket path from constructor', () => {
    const c = new OpenLanderClient('/custom/path.sock');
    expect(c.isSocketPresent()).toBe(false);
  });

  it('isSocketPresent returns true when file exists', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(socketPath, '', 'utf-8');
    expect(client.isSocketPresent()).toBe(true);
  });

  it('isSocketPresent returns false when file does not exist', () => {
    expect(client.isSocketPresent()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ping / health
  // ---------------------------------------------------------------------------

  it('ping() sends GET /health and returns parsed response', async () => {
    const healthResponse: HealthResponse = {
      status: 'ok',
      version: '0.4.0',
      llmConfigured: true,
      timestamp: new Date().toISOString(),
      uptime: 3600,
      dockerContainers: 3,
    };

    const { res, end } = createMockResponse(200, JSON.stringify(healthResponse));
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    const result = await client.ping();

    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.4.0');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const callOptions = mockRequest.mock.calls[0]?.[0] as { path: string; method: string };
    expect(callOptions.path).toBe('/health');
    expect(callOptions.method).toBe('GET');
  });

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------

  it('chat() sends POST /api/chat with correct body', async () => {
    const chatResponse = {
      sessionId: 'session-123',
      message: 'Hello! How can I help?',
      toolResults: undefined,
    };

    const { res, end } = createMockResponse(200, JSON.stringify(chatResponse));
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    const result = await client.chat('Hello', 'session-123');

    expect(result.message).toBe('Hello! How can I help?');
    const callOptions = mockRequest.mock.calls[0]?.[0] as { path: string; method: string };
    expect(callOptions.path).toBe('/api/chat');
    expect(callOptions.method).toBe('POST');
    expect(mockReq.write).toHaveBeenCalledWith(expect.stringContaining('Hello'));
  });

  // ---------------------------------------------------------------------------
  // chatStream
  // ---------------------------------------------------------------------------

  it('chatStream() parses SSE events correctly', async () => {
    const events: Array<{ type: string }> = [];

    // SSE format: each event is 'data: JSON' followed by blank line
    const sseData =
      'data: {"type":"session","sessionId":"s1"}\n\n' +
      'data: {"type":"message","content":"Hello"}\n\n' +
      'data: {"type":"done"}\n\n';

    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = 200;
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    // Use setImmediate to ensure data is emitted after the handlers are set up
    setImmediate(() => {
      res.emit('data', Buffer.from(sseData));
      setImmediate(() => {
        res.emit('end');
      });
    });

    await client.chatStream('Hello', 's1', (event) => {
      events.push(event as { type: string });
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.type).toBe('session');
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('chatStream() handles error status codes', async () => {
    const { res, end } = createMockResponse(500, 'Internal Server Error');
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    await expect(client.chatStream('Hello', 's1', () => {})).rejects.toThrow('Daemon error 500');
  });

  // ---------------------------------------------------------------------------
  // listProjects
  // ---------------------------------------------------------------------------

  it('listProjects() returns parsed project list', async () => {
    const projectList = {
      count: 1,
      projects: [
        {
          id: 'p1',
          name: 'my-app',
          status: 'running',
          visibility: 'internal',
          repoUrl: 'https://github.com/user/my-app',
          branch: 'main',
          port: 10001,
          url: 'http://my-app.localhost',
          publicUrl: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ] as Project[],
    };

    const { res, end } = createMockResponse(200, JSON.stringify(projectList));
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    const result = await client.listProjects();

    expect(result.count).toBe(1);
    expect(result.projects[0]?.name).toBe('my-app');
  });

  it('listProjects() passes status filter in query string', async () => {
    const { res, end } = createMockResponse(200, JSON.stringify({ count: 0, projects: [] }));
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    await client.listProjects('running');

    const callOptions = mockRequest.mock.calls[0]?.[0] as { path: string };
    expect(callOptions.path).toContain('?status=running');
  });

  // ---------------------------------------------------------------------------
  // getSystemStats
  // ---------------------------------------------------------------------------

  it('getSystemStats() returns stats object', async () => {
    const stats = {
      summary: 'CPU: 25%, Memory: 60%',
      cpu: { usagePercent: 25, cores: 4 },
      memory: { usagePercent: 60, totalMB: 16384 },
      disk: { usagePercent: 45, totalGB: 500 },
    };

    const { res, end } = createMockResponse(200, JSON.stringify(stats));
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    const result = await client.getSystemStats();

    expect(result.summary).toBe('CPU: 25%, Memory: 60%');
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('handles ENOENT error (daemon not running)', async () => {
    const { req: mockReq, emitError } = createMockRequest();

    mockRequest.mockImplementation(() => mockReq);

    setTimeout(() => {
      const err = new Error('connect ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      emitError(err);
    }, 10);

    await expect(client.ping()).rejects.toThrow('Daemon not running');
  });

  it('handles ECONNREFUSED error', async () => {
    const { req: mockReq, emitError } = createMockRequest();

    mockRequest.mockImplementation(() => mockReq);

    setTimeout(() => {
      const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
      err.code = 'ECONNREFUSED';
      emitError(err);
    }, 10);

    await expect(client.ping()).rejects.toThrow('Daemon not responding');
  });

  it('handles malformed JSON response', async () => {
    const { res, end } = createMockResponse(200, 'not valid json');
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    await expect(client.ping()).rejects.toThrow('Invalid JSON from daemon');
  });

  it('handles HTTP error status codes', async () => {
    const { res, end } = createMockResponse(404, 'Not Found');
    const { req: mockReq } = createMockRequest();

    mockRequest.mockImplementation((_options, callback) => {
      callback(res as unknown as Parameters<Parameters<typeof request>[1]>[0]);
      return mockReq;
    });

    setTimeout(end, 10);

    await expect(client.getProject('nonexistent')).rejects.toThrow('Daemon error 404');
  });
});
