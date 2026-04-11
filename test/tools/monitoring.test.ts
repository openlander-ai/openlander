import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import type { ToolContext } from '../../src/tools/defs/types.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getProbeHostTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'probe_host',
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createMockContext(overrides?: {
  containers?: { id: string; status: string }[];
  execResult?: { exitCode: number; stdout: string; stderr: string };
}) {
  const ctx = {
    docker: {
      listManagedContainers: vi.fn(async () => overrides?.containers ?? []),
      execSimple: vi.fn(
        async () => overrides?.execResult ?? { exitCode: 0, stdout: '', stderr: '' },
      ),
    },
  } as unknown as AppContext;

  return ctx;
}

describe('probe_host tool', () => {
  it('is included in monitoringToolDefs', () => {
    const tool = monitoringToolDefs.find((t) => t.name === 'probe_host');
    expect(tool).toBeDefined();
    expect(tool!.riskLevel).toBe('low');
    expect(tool!.description).toContain('reachable');
    expect(tool!.inputSchema).toBeDefined();
  });

  it('is accessible via shared registry', () => {
    const ctx = createMockContext();
    const tool = getProbeHostTool(ctx);
    expect(tool.name).toBe('probe_host');
  });

  describe('HTTP probe', () => {
    it('returns reachable for successful HTTP target', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 }));

      try {
        const result = (await tool.execute(
          { target: 'http://localhost:3000', path: '/health' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.reachable).toBe(true);
        expect(result.status_code).toBe(200);
        expect(result.protocol_used).toBe('http');
        expect(result.target_resolved).toContain('localhost');
        expect(result.latency_ms).toBeTypeOf('number');
        expect(result._agent_guidance).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns not reachable for 500 status', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response('Error', { status: 500 }));

      try {
        const result = (await tool.execute(
          { target: 'http://localhost:3000' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.reachable).toBe(false);
        expect(result.status_code).toBe(500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns reachable for 3xx redirect', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response('', { status: 301 }));

      try {
        const result = (await tool.execute(
          { target: 'http://localhost:3000' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.reachable).toBe(true);
        expect(result.status_code).toBe(301);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns not reachable on fetch error', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      try {
        const result = (await tool.execute(
          { target: 'http://localhost:9999' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.reachable).toBe(false);
        expect(result.error).toContain('ECONNREFUSED');
        expect(result.protocol_used).toBe('http');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('auto-detects HTTPS from URL', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 }));

      try {
        const result = (await tool.execute(
          { target: 'https://example.com' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.protocol_used).toBe('https');
        expect(result.reachable).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('TCP probe', () => {
    it('uses TCP when protocol=tcp is specified', async () => {
      const ctx = createMockContext();
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;

      const context: ToolContext = { target: 'mcp', appCtx: ctx };

      const result = (await tool.execute(
        { target: 'localhost', port: 19, protocol: 'tcp', timeout_ms: 500 },
        context,
      )) as Record<string, unknown>;

      expect(result.protocol_used).toBe('tcp');
      expect(result.reachable).toBe(false);
      expect(result.latency_ms).toBeTypeOf('number');
    });

    it('auto-detects TCP for host:port pattern', async () => {
      const ctx = createMockContext();
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;

      const context: ToolContext = { target: 'mcp', appCtx: ctx };

      const result = (await tool.execute(
        { target: 'localhost:19', timeout_ms: 500 },
        context,
      )) as Record<string, unknown>;

      expect(result.protocol_used).toBe('tcp');
      expect(result.reachable).toBe(false);
    });
  });

  describe('internal probe', () => {
    it('returns error when no running containers', async () => {
      const ctx = createMockContext({ containers: [] });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'my-service', port: 5432, protocol: 'tcp', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('No running managed containers');
    });

    it('executes TCP probe inside container', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-1', status: 'running' }],
        execResult: { exitCode: 0, stdout: '', stderr: '' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'ol-svc-postgres', port: 5432, protocol: 'tcp', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(true);
      expect(result.protocol_used).toBe('tcp');
      expect(ctx.docker.execSimple).toHaveBeenCalledWith('container-1', [
        'nc',
        '-z',
        '-w5',
        'ol-svc-postgres',
        '5432',
      ]);
    });

    it('executes HTTP probe inside container', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-2', status: 'running' }],
        execResult: { exitCode: 0, stdout: 'OK', stderr: '' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'http://my-app:3000', path: '/health', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(true);
      expect(ctx.docker.execSimple).toHaveBeenCalledWith('container-2', [
        'curl',
        '-sf',
        '--max-time',
        '5',
        'http://my-app:3000/health',
      ]);
    });

    it('returns not reachable on exec failure', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-3', status: 'running' }],
        execResult: { exitCode: 7, stdout: '', stderr: 'Connection refused' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'missing-service', port: 8080, protocol: 'tcp', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('handles exec exception gracefully', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-4', status: 'running' }],
      });
      (ctx.docker.execSimple as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Container not found'),
      );
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'service', port: 80, protocol: 'tcp', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('Container not found');
    });
  });

  describe('schema validation', () => {
    it('requires target field', () => {
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts minimal input', () => {
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;
      const result = tool.inputSchema.safeParse({ target: 'localhost' });
      expect(result.success).toBe(true);
    });

    it('accepts full input', () => {
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;
      const result = tool.inputSchema.safeParse({
        target: 'http://example.com',
        port: 8080,
        protocol: 'http',
        path: '/health',
        timeout_ms: 3000,
        internal: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid protocol', () => {
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;
      const result = tool.inputSchema.safeParse({ target: 'localhost', protocol: 'ws' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid port', () => {
      const tool = monitoringToolDefs.find((t) => t.name === 'probe_host')!;
      const result = tool.inputSchema.safeParse({ target: 'localhost', port: 70000 });
      expect(result.success).toBe(false);
    });
  });
});
