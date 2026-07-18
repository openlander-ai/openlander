import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import type { AiOpsBriefingRow } from '../../src/db/types.js';
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

function getMonitoringTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createMockContext(overrides?: {
  containers?: { id: string; status: string }[];
  execResult?: { exitCode: number; stdout: string; stderr: string };
}) {
  const containers = overrides?.containers ?? [];
  const service = {
    id: 'svc-1',
    name: 'demo__svc',
    project_id: 'p1',
    kind: 'git',
    container_id: containers[0]?.id ?? 'container-1',
  };
  const ctx = {
    db: {
      getService: vi.fn(async (id: string) => (id === 'svc-1' ? service : undefined)),
      getProject: vi.fn(async (id: string) =>
        id === 'p1' ? { id: 'p1', name: 'demo' } : undefined,
      ),
    },
    docker: {
      listManagedContainers: vi.fn(async () => containers),
      execSimple: vi.fn(
        async () => overrides?.execResult ?? { exitCode: 0, stdout: '', stderr: '' },
      ),
    },
  } as unknown as AppContext;

  return ctx;
}

function makeAiOpsBriefingRow(overrides: Partial<AiOpsBriefingRow> = {}): AiOpsBriefingRow {
  return {
    id: 'brief-1',
    project_id: 'p1',
    service_id: 'svc-1',
    dedupe_key: 'p1:svc-1:route_failure',
    fingerprint: 'route_failure',
    classification: 'route_failure',
    severity: 'high',
    title: 'Public route is failing',
    deterministic_summary: 'The public route returned HTTP 502 while the container is running.',
    llm_summary: null,
    llm_summary_status: null,
    llm_summary_finish_reason: null,
    llm_summary_truncated: null,
    llm_summary_error: null,
    llm_summary_usage_json: null,
    suggested_call_json: JSON.stringify({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    }),
    evidence_json: JSON.stringify({
      route_health: { reachable: false, status_code: 502 },
      container_state: { running: true },
    }),
    status: 'open',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    server_id: 'local',
    ...overrides,
  };
}

function getDirectMonitoringTool(name: string) {
  const tool = monitoringToolDefs.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
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

    it('accepts host as an alias for target', async () => {
      const ctx = createMockContext();
      const tool = getProbeHostTool(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 }));

      try {
        const result = (await tool.execute(
          { host: 'http://localhost:3000', path: '/health' },
          { target: 'mcp' },
        )) as Record<string, unknown>;

        expect(result.reachable).toBe(true);
        expect(result.target_resolved).toContain('localhost');
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
    it('requires project context for internal Docker DNS probes', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-1', status: 'running' }],
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'my-service', port: 5432, protocol: 'tcp', internal: true },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toBe('INTERNAL_PROBE_CONTEXT_REQUIRED');
    });

    it('returns error when no running containers', async () => {
      const ctx = createMockContext({ containers: [] });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'my-service', port: 5432, protocol: 'tcp', internal: true, service_id: 'svc-1' },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('No running target project container');
    });

    it('executes TCP probe inside container', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-1', status: 'running' }],
        execResult: { exitCode: 0, stdout: '', stderr: '' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        {
          target: 'ol-svc-postgres',
          port: 5432,
          protocol: 'tcp',
          internal: true,
          service_id: 'svc-1',
        },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(true);
      expect(result.protocol_used).toBe('tcp');
      expect(ctx.docker.execSimple).toHaveBeenCalledWith(
        'container-1',
        expect.arrayContaining(['sh', '-c', expect.stringContaining('command -v nc')]),
      );
    });

    it('executes HTTP probe inside container', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-2', status: 'running' }],
        execResult: { exitCode: 0, stdout: 'OK', stderr: '' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        { target: 'http://my-app:3000', path: '/health', internal: true, service_id: 'svc-1' },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(true);
      expect(ctx.docker.execSimple).toHaveBeenCalledWith(
        'container-2',
        expect.arrayContaining(['curl', '-w', '%{http_code}', '5', 'http://my-app:3000/health']),
      );
    });

    it('returns not reachable on exec failure', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-3', status: 'running' }],
        execResult: { exitCode: 7, stdout: '', stderr: 'Connection refused' },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        {
          target: 'missing-service',
          port: 8080,
          protocol: 'tcp',
          internal: true,
          service_id: 'svc-1',
        },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('marks missing TCP probe tools separately from target connectivity failures', async () => {
      const ctx = createMockContext({
        containers: [{ id: 'container-5', status: 'running' }],
        execResult: {
          exitCode: 127,
          stdout: '',
          stderr: 'No TCP probe tool available: install nc, bash, or node in the exec container',
        },
      });
      const tool = getProbeHostTool(ctx);

      const result = (await tool.execute(
        {
          target: 'ol-svc-postgres',
          port: 5432,
          protocol: 'tcp',
          internal: true,
          service_id: 'svc-1',
        },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.reachable).toBe(false);
      expect(result.probe_tool_unavailable).toBe(true);
      expect(result.error).toContain('No TCP probe tool available');
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
        { target: 'service', port: 80, protocol: 'tcp', internal: true, service_id: 'svc-1' },
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

describe('AI Ops briefing monitor actions', () => {
  it('lists persisted briefings without full evidence', async () => {
    const row = makeAiOpsBriefingRow();
    const db = {
      listAiOpsBriefingsByProject: vi.fn(async () => [row]),
      listAiOpsBriefingsByService: vi.fn(async () => []),
    };
    const ctx = { db } as unknown as AppContext;
    const tool = getDirectMonitoringTool('list_ai_ops_briefings');

    const result = (await tool.execute(
      { project_id: 'p1', limit: 5, status: 'open' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(db.listAiOpsBriefingsByProject).toHaveBeenCalledWith('p1', {
      limit: 5,
      status: 'open',
    });
    expect(result.status).toBe('ok');
    expect(result.count).toBe(1);
    const briefings = result.briefings as Array<Record<string, unknown>>;
    expect(briefings[0]?.briefing_id).toBe('brief-1');
    expect(briefings[0]?.summary).toContain('HTTP 502');
    expect(briefings[0]?.diagnostic_call).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { project_id: 'p1', service_id: 'svc-1', briefing_id: 'brief-1' },
    });
    expect(briefings[0]).not.toHaveProperty('suggested_call');
    expect(briefings[0]).not.toHaveProperty('evidence');
    expect(briefings[0]).not.toHaveProperty('deterministic_summary');
    expect(briefings[0]).not.toHaveProperty('llm_summary');
    expect(briefings[0]).not.toHaveProperty('summary_usage');
    expect(briefings[0]).not.toHaveProperty('summary_finish_reason');
    expect(briefings[0]).not.toHaveProperty('summary_error');
    expect(briefings[0]).not.toHaveProperty('summary_source');
    expect(briefings[0]).not.toHaveProperty('summary_status');
    expect(briefings[0]).not.toHaveProperty('summary_truncated');
    expect(briefings[0]).not.toHaveProperty('fingerprint');
    expect(briefings[0]).not.toHaveProperty('dedupe_key');
  });

  it('lists recent open briefings for agent-primary triage without a project target', async () => {
    const row = makeAiOpsBriefingRow();
    const db = {
      listRecentAiOpsBriefings: vi.fn(async () => [row]),
      listAiOpsBriefingsByProject: vi.fn(async () => []),
      listAiOpsBriefingsByService: vi.fn(async () => []),
    };
    const ctx = { db } as unknown as AppContext;
    const tool = getDirectMonitoringTool('list_ai_ops_briefings');

    const result = (await tool.execute(
      { limit: 10, status: 'open' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(db.listRecentAiOpsBriefings).toHaveBeenCalledWith({ limit: 10, status: 'open' });
    expect(db.listAiOpsBriefingsByProject).not.toHaveBeenCalled();
    expect(db.listAiOpsBriefingsByService).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'ok',
      count: 1,
      scope: 'instance',
    });
    const briefings = result.briefings as Array<Record<string, unknown>>;
    expect(briefings[0]?.briefing_id).toBe('brief-1');
    expect(briefings[0]?.diagnostic_call).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { project_id: 'p1', service_id: 'svc-1', briefing_id: 'brief-1' },
    });
    expect(briefings[0]).not.toHaveProperty('suggested_call');
    expect(briefings[0]).not.toHaveProperty('evidence');
  });

  it('lists service-scoped briefings when service_id is supplied', async () => {
    const row = makeAiOpsBriefingRow({ id: 'brief-service' });
    const db = {
      listAiOpsBriefingsByProject: vi.fn(async () => []),
      listAiOpsBriefingsByService: vi.fn(async () => [row]),
    };
    const ctx = { db } as unknown as AppContext;
    const tool = getDirectMonitoringTool('list_ai_ops_briefings');

    const result = (await tool.execute(
      { service_id: 'svc-1' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(db.listAiOpsBriefingsByService).toHaveBeenCalledWith('svc-1', {
      limit: 20,
      status: undefined,
    });
    expect(db.listAiOpsBriefingsByProject).not.toHaveBeenCalled();
    const briefings = result.briefings as Array<Record<string, unknown>>;
    expect(briefings[0]?.briefing_id).toBe('brief-service');
  });

  it('gets one briefing with full evidence', async () => {
    const row = makeAiOpsBriefingRow({
      llm_summary: 'LLM explanation from evidence.',
      llm_summary_status: 'llm',
      llm_summary_finish_reason: 'stop',
      llm_summary_truncated: false,
      llm_summary_usage_json: JSON.stringify({ output_tokens: 42 }),
    });
    const db = {
      getAiOpsBriefing: vi.fn(async () => row),
    };
    const ctx = { db } as unknown as AppContext;
    const tool = getDirectMonitoringTool('get_ai_ops_briefing');

    const result = (await tool.execute(
      { briefing_id: 'brief-1' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(db.getAiOpsBriefing).toHaveBeenCalledWith('brief-1');
    expect(result.status).toBe('ok');
    const briefing = result.briefing as Record<string, unknown>;
    expect(briefing.summary).toBe('LLM explanation from evidence.');
    expect(briefing).toMatchObject({
      summary_source: 'llm',
      summary_status: 'llm',
      summary_truncated: false,
      summary_finish_reason: 'stop',
      summary_usage: { output_tokens: 42 },
    });
    expect(briefing.deterministic_summary).toContain('HTTP 502');
    expect(briefing.suggested_call).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { project_id: 'p1', service_id: 'svc-1', briefing_id: 'brief-1' },
    });
    expect(briefing.diagnostic_call).toEqual(briefing.suggested_call);
    expect(briefing.evidence).toEqual({
      route_health: { reachable: false, status_code: 502 },
      container_state: { running: true },
    });
    expect(briefing.evidence_metadata).toMatchObject({
      observed_at: '2026-06-11T00:00:00.000Z',
      live: false,
      source: 'briefing_snapshot',
      input_cap_applied: false,
      omitted_evidence: [],
    });
  });

  it('returns not_found for missing briefing ids', async () => {
    const db = {
      getAiOpsBriefing: vi.fn(async () => null),
    };
    const ctx = { db } as unknown as AppContext;
    const tool = getDirectMonitoringTool('get_ai_ops_briefing');

    const result = (await tool.execute(
      { briefing_id: 'missing' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'not_found',
      error: 'AI_OPS_BRIEFING_NOT_FOUND',
      briefing_id: 'missing',
    });
  });
});

describe('diagnose_host_resources tool', () => {
  function dockerStats(opts: {
    cpuTotal: number;
    preCpuTotal: number;
    systemTotal: number;
    preSystemTotal: number;
    memoryUsage: number;
    memoryLimit: number;
  }) {
    return {
      cpu_stats: {
        cpu_usage: { total_usage: opts.cpuTotal, percpu_usage: [1, 1] },
        system_cpu_usage: opts.systemTotal,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: opts.preCpuTotal },
        system_cpu_usage: opts.preSystemTotal,
      },
      memory_stats: {
        usage: opts.memoryUsage,
        limit: opts.memoryLimit,
      },
    };
  }

  it('summarizes Docker health, disk totals, and top resource containers', async () => {
    const ctx = {
      docker: {
        status: vi.fn(async () => ({ state: 'running' })),
        listAllContainers: vi.fn(async () => [
          {
            id: 'c-heavy',
            name: 'external-heavy',
            image: 'worker:latest',
            state: 'running',
            status: 'Up 1 hour',
            ports: [],
            labels: {},
            managedByOpenLander: false,
            composeProject: null,
            created: 1,
          },
          {
            id: 'c-app',
            name: 'ol-demo-app',
            image: 'openlander/demo:latest',
            state: 'running',
            status: 'Up 5 minutes',
            ports: [],
            labels: {
              'openlander.managed': 'true',
              'openlander.role': 'service',
              'openlander.project': 'demo',
              'openlander.service': 'demo__svc',
            },
            managedByOpenLander: true,
            composeProject: 'demo-stack',
            created: 2,
          },
          {
            id: 'c-old',
            name: 'old',
            image: 'old:latest',
            state: 'exited',
            status: 'Exited',
            ports: [],
            labels: {},
            managedByOpenLander: false,
            composeProject: null,
            created: 3,
          },
        ]),
        getContainerStats: vi.fn(async (containerId: string) =>
          containerId === 'c-heavy'
            ? dockerStats({
                cpuTotal: 130,
                preCpuTotal: 100,
                systemTotal: 400,
                preSystemTotal: 100,
                memoryUsage: 800_000_000,
                memoryLimit: 1_000_000_000,
              })
            : dockerStats({
                cpuTotal: 110,
                preCpuTotal: 100,
                systemTotal: 300,
                preSystemTotal: 100,
                memoryUsage: 120_000_000,
                memoryLimit: 500_000_000,
              }),
        ),
        getDiskUsage: vi.fn(async () => ({
          Images: [{ Size: 1_000_000 }],
          Containers: [{ SizeRw: 2_000_000 }],
          Volumes: [{ UsageData: { Size: 3_000_000 } }],
        })),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_host_resources').execute(
      { container_limit: 1 },
      { target: 'mcp', appCtx: ctx } as unknown as ToolContext,
    )) as Record<string, unknown>;

    expect(result.docker).toMatchObject({ reachable: true, status: { state: 'running' } });
    expect(result.containers).toMatchObject({
      total: 3,
      running: 2,
      exited: 1,
      sampled: 2,
      statsSampleLimit: 50,
      sampleLimitReached: false,
    });
    expect(result.units).toMatchObject({
      cpuPercent: 'percent',
      memoryMb: 'MB decimal',
      diskMb: 'MB decimal',
    });
    expect(result.dockerDiskUsage).toMatchObject({
      available: true,
      images: { count: 1, totalSizeMb: 1 },
      containers: { count: 1, totalSizeMb: 2 },
      volumes: { count: 1, totalSizeMb: 3 },
    });
    expect((result.containers as { topByMemory: Array<{ name: string }> }).topByMemory).toEqual([
      expect.objectContaining({ name: 'external-heavy' }),
    ]);
  });

  it('marks when running container resource stats are truncated', async () => {
    const ctx = {
      docker: {
        status: vi.fn(async () => ({ state: 'running' })),
        listAllContainers: vi.fn(async () =>
          Array.from({ length: 51 }, (_, index) => ({
            id: `c-${index}`,
            name: `worker-${index}`,
            image: 'worker:latest',
            state: 'running',
            status: 'Up 1 minute',
            ports: [],
            labels: {},
            managedByOpenLander: false,
            composeProject: null,
            created: index,
          })),
        ),
        getContainerStats: vi.fn(async () =>
          dockerStats({
            cpuTotal: 110,
            preCpuTotal: 100,
            systemTotal: 300,
            preSystemTotal: 100,
            memoryUsage: 10_000_000,
            memoryLimit: 100_000_000,
          }),
        ),
        getDiskUsage: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_host_resources').execute(
      { include_disk_usage: false },
      { target: 'mcp', appCtx: ctx } as unknown as ToolContext,
    )) as Record<string, unknown>;

    expect(result.containers).toMatchObject({
      total: 51,
      running: 51,
      sampled: 50,
      statsSampleLimit: 50,
      sampleLimitReached: true,
    });
    expect(ctx.docker.getContainerStats).toHaveBeenCalledTimes(50);
  });

  it('surfaces container listing failures instead of treating them as zero containers', async () => {
    const ctx = {
      docker: {
        status: vi.fn(async () => ({ state: 'running' })),
        listAllContainers: vi.fn(async () => {
          throw new Error('permission denied listing containers');
        }),
        getContainerStats: vi.fn(),
        getDiskUsage: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_host_resources').execute(
      { include_disk_usage: false },
      { target: 'mcp', appCtx: ctx } as unknown as ToolContext,
    )) as Record<string, unknown>;

    expect(result.docker).toMatchObject({ reachable: true, status: { state: 'running' } });
    expect(result.containers).toMatchObject({
      total: 0,
      listError: 'permission denied listing containers',
      sampled: 0,
    });
    expect(result.findings).toContain('docker_container_list_unavailable');
    expect(JSON.stringify(result)).toContain(
      'Docker is reachable, but OpenLander could not list containers',
    );
    expect(ctx.docker.getContainerStats).not.toHaveBeenCalled();
  });

  it('returns guidance instead of throwing when Docker is unavailable', async () => {
    const ctx = {
      docker: {
        status: vi.fn(async () => {
          throw new Error('Docker daemon not reachable');
        }),
        listAllContainers: vi.fn(),
        getContainerStats: vi.fn(),
        getDiskUsage: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_host_resources').execute({}, {
      target: 'mcp',
      appCtx: ctx,
    } as unknown as ToolContext)) as Record<string, unknown>;

    expect(result.docker).toMatchObject({
      reachable: false,
      status: { state: 'not_running', error: 'Docker daemon not reachable' },
    });
    expect(result.findings).toContain('docker_unreachable');
    expect(JSON.stringify(result)).toContain('Docker is not reachable');
    expect(ctx.docker.listAllContainers).not.toHaveBeenCalled();
  });
});

describe('diagnose_service tool', () => {
  it.each([
    {
      role: 'resource' as const,
      state: {
        Running: true,
        Status: 'running',
        ExitCode: 0,
        Health: { Status: 'healthy' },
      },
      expectedStrategy: 'docker_health',
    },
    {
      role: 'job' as const,
      state: { Running: false, Status: 'exited', ExitCode: 0 },
      expectedStrategy: 'exit_code',
    },
  ])('uses role-specific diagnostics for $role without HTTP probes', async (fixture) => {
    const project = { id: 'stack', name: 'stack', status: 'running', archived_at: null };
    const service = {
      id: `stack-${fixture.role}__svc`,
      project_id: 'stack',
      parent_service_id: 'stack__svc',
      runtime_role: fixture.role,
      name: fixture.role === 'resource' ? 'db' : 'migrate',
      kind: 'compose-child',
      source: 'git',
      status: fixture.role === 'job' ? 'stopped' : 'running',
      assigned_port: null,
      container_id: `container-${fixture.role}`,
      container_name: `ol-stack-${fixture.role}`,
      container_port: fixture.role === 'resource' ? 5432 : null,
      image_url: fixture.role === 'resource' ? 'postgres:16' : 'app:latest',
      image_tag: null,
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:00:00.000Z',
      archived_at: null,
      server_id: 'local',
    };
    const ctx = {
      db: {
        getProject: vi.fn(() => project),
        getProjectByName: vi.fn(() => project),
        getService: vi.fn(() => service),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({})),
        getDeployLogs: vi.fn(async () => []),
      },
      pipeline: { getLogs: vi.fn(async () => 'role log') },
      docker: {
        inspectContainer: vi.fn(async () => ({
          Name: `/${service.container_name}`,
          State: fixture.state,
          Config: { Image: service.image_url },
        })),
        listManagedContainers: vi.fn(async () => [
          { id: service.container_id, status: fixture.state.Running ? 'running' : 'stopped' },
        ]),
        execSimple: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: service.id },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result.service).toMatchObject({
      runtimeRole: fixture.role,
      healthStrategy: fixture.expectedStrategy,
    });
    expect(result.roleCheck).toMatchObject({
      strategy: fixture.expectedStrategy,
      healthy: true,
    });
    expect(result).not.toHaveProperty('httpCheck');
    expect(result).not.toHaveProperty('route');
  });

  it('summarizes masked env keys and flags runtime-only build-time errors', async () => {
    const jwtFixture = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ].join('.');
    const basicAuthFixture = ['dXNl', 'cjpwYXNz'].join('');
    const githubPatFixture = ['github', '_pat_', '11ABCDE1234567890abcdefTOKEN-from-CI'].join('');
    const ghpFixture = ['gh', 'p_', '1234567890abcdef1234567890abcdef1234'].join('');
    const slackBotFixture = ['xox', 'b-', '1234567890-abcdefSECRET'].join('');
    const stripeSecretFixture = ['stripe_', 'sk_test_', '4eC39HqLyjWDarjtT1zdp7dc'].join('');
    const stripeRestrictedFixture = ['stripe_', 'rk_live_', 'rk_51RestrictedKey'].join('');
    const apiKeyFixture = ['abcdef', '123456'].join('');
    const awsAccessKeyFixture = ['AKIA', 'IOSFODNN7EXAMPLE'].join(''); // AKIA + 16
    const awsSessionKeyFixture = ['ASIA', 'A1B2C3D4E5F6G7H8'].join(''); // ASIA + 16
    const googleApiKeyFixture = ['AIza', 'SyA-GoogleExample123456789_ABCDE-ky'].join(''); // AIza + 35
    const openaiTokenFixture = ['sk-', 'proj-AbcDefGhIjKlMnOpQrStUv'].join(''); // sk- + 26
    const anthropicTokenFixture = ['sk-ant-', 'api03-AbcDefGhIjKlMnOpQrStUvWx'].join(''); // sk-ant- + 28
    const sendgridTokenFixture = [
      'SG.',
      'AbCdEfGhIjKlMnOpQrStUv', // 22
      '.',
      'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQ', // 43
    ].join('');
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const service = {
      id: 'app__svc',
      project_id: 'app',
      name: 'web',
      kind: 'git',
      source: 'git',
      status: 'error',
      visibility: 'internal',
      assigned_port: 10001,
      container_id: 'container-1',
      container_name: 'ol-app',
      container_port: 3000,
      image_tag: 'app:failed',
      previous_image_tag: null,
      public_url: null,
      dockerfile_path: 'Dockerfile',
      docker_target: null,
      build_context: null,
      build_method: 'dockerfile',
      repo_url: 'https://github.com/acme/app.git',
      branch: 'main',
      image_url: null,
      image_cmd: null,
      pending_fix: null,
      access_code: null,
      access_code_iv: null,
      is_preview: 0,
      pr_number: null,
      project_type: 'web',
      health_check_strategy: 'http',
      health_check_path: '/health',
      recovering_started_at: null,
      credentials: null,
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z',
      archived_at: null,
      server_id: 'local',
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({
          DATABASE_URL: 'postgresql://postgres:secret@ol-db:5432/app',
          NEXT_PUBLIC_BASE_PATH: '/admin',
        })),
        getDeployLogs: vi.fn(async () => [
          {
            id: 'deploy-1',
            service_id: 'app__svc',
            environment_id: null,
            status: 'failed',
            trigger: 'api',
            trigger_detail: null,
            commit_sha: 'abc123',
            commit_message: 'test',
            build_log: `Collecting page data\nDATABASE_URL=postgresql://postgres:secret@ol-db:5432/app\nAuthorization: Bearer ${jwtFixture}\nAuthorization: Basic ${basicAuthFixture}\nplain ${githubPatFixture}\nAWS creds ${awsAccessKeyFixture} ${awsSessionKeyFixture}\nGoogle ${googleApiKeyFixture}\nOpenAI ${openaiTokenFixture}\nAnthropic ${anthropicTokenFixture}\nSendGrid ${sendgridTokenFixture}\nError: DATABASE_URL is not set`,
            runtime_log: null,
            duration_ms: 12000,
            created_at: '2026-05-12T00:01:00.000Z',
          },
        ]),
        resolveAiOpsPendingInputsForServiceKeys: vi.fn(async () => 0),
      },
      pipeline: {
        getLogs: vi.fn(
          async () =>
            `runtime log line\nREDIS_URL=redis://:secret@redis:6379/0\n${slackBotFixture}\nAPI_KEY = ${apiKeyFixture}`,
        ),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          Name: '/ol-app',
          RestartCount: 0,
          State: {
            Running: false,
            Status: 'exited',
            ExitCode: 1,
            Error: `pull failed https://robot:secret@registry.example.com/image with ${ghpFixture}, ${stripeSecretFixture}, and ${stripeRestrictedFixture}`,
            StartedAt: '2026-05-12T00:00:00.000Z',
            FinishedAt: '2026-05-12T00:02:00.000Z',
          },
          Config: { Image: 'registry.example.com/app:failed' },
        })),
        listManagedContainers: vi.fn(async () => [{ id: 'container-1', status: 'running' }]),
        execSimple: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'connection refused' })),
      },
    } as unknown as AppContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('error', { status: 500 }));

    try {
      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { service_id: 'app__svc', lines: 10 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result.service).toMatchObject({ id: 'app__svc', source: 'git' });
      expect(result.env).toMatchObject({
        keys: ['DATABASE_URL', 'NEXT_PUBLIC_BASE_PATH'],
        masked: true,
      });
      expect(result.buildTimeEnv).toMatchObject({
        suspectedMissingBuildTimeKeys: ['DATABASE_URL'],
      });
      expect(JSON.stringify(result)).not.toContain('postgres:secret');
      expect(JSON.stringify(result)).not.toContain('robot:secret');
      expect(JSON.stringify(result)).not.toContain('redis://:secret');
      expect(JSON.stringify(result)).not.toContain('eyJhbGci');
      expect(JSON.stringify(result)).not.toContain('dXNl');
      expect(JSON.stringify(result)).not.toContain('github_pat_11');
      expect(JSON.stringify(result)).not.toContain('from-CI');
      expect(JSON.stringify(result)).not.toContain('ghp_123');
      expect(JSON.stringify(result)).not.toContain('xoxb-123');
      expect(JSON.stringify(result)).not.toContain('stripe_sk_test');
      expect(JSON.stringify(result)).not.toContain('stripe_rk_live');
      expect(JSON.stringify(result)).not.toContain('abcdef123456');
      expect(JSON.stringify(result)).not.toContain('IOSFODNN7EXAMPLE');
      expect(JSON.stringify(result)).not.toContain('A1B2C3D4E5F6G7H8');
      expect(JSON.stringify(result)).not.toContain('SyA-GoogleExample');
      expect(JSON.stringify(result)).not.toContain('proj-AbcDef');
      expect(JSON.stringify(result)).not.toContain('api03-AbcDef');
      expect(JSON.stringify(result)).not.toContain('AbCdEfGhIjKlMnOpQrStUv');
      expect(JSON.stringify(result)).toContain('DATABASE_URL=***');
      expect(JSON.stringify(result)).toContain('Bearer ***');
      expect(JSON.stringify(result)).toContain('Basic ***');
      expect(JSON.stringify(result)).toContain('API_KEY=***');
      expect(JSON.stringify(result)).toContain('aws_***');
      expect(JSON.stringify(result)).toContain('google_***');
      expect(JSON.stringify(result)).toContain('openai_***');
      expect(JSON.stringify(result)).toContain('anthropic_***');
      expect(JSON.stringify(result)).toContain('sendgrid_***');
      expect(result.httpCheck).toMatchObject({
        probe_mode: 'internal_docker_dns',
        target_resolved: 'http://ol-app:3000/admin',
      });
      expect(JSON.stringify(result.httpCheck)).not.toContain('127.0.0.1');
      expect(result.evidence).toMatchObject({
        projectId: 'app',
        serviceId: 'app__svc',
        serviceName: 'web',
        routeHealth: {
          status: 'unhealthy',
        },
        container: {
          name: 'ol-app',
          running: false,
          status: 'exited',
          exitCode: 1,
        },
      });
      const evidenceMetadata = result.evidence_metadata as Record<string, unknown>;
      expect(evidenceMetadata).toMatchObject({
        live: true,
        source: 'diagnose_service',
        input_cap_applied: false,
        omitted_evidence: [],
      });
      expect(typeof evidenceMetadata['observed_at']).toBe('string');
      expect(evidenceMetadata['input_token_estimate']).toEqual(expect.any(Number));
      const deployment = result.recentDeployment as {
        latest?: { buildLogTailSanitized?: boolean; fullBuildLogHint?: string };
      };
      expect(deployment.latest).toMatchObject({
        buildLogTailSanitized: true,
        fullBuildLogHint: expect.stringContaining('get_build_log'),
      });
      expect(result._agent_guidance).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('probes from inside the service container when internal=true', async () => {
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const service = {
      id: 'app__svc',
      project_id: 'app',
      name: 'web',
      kind: 'git',
      source: 'git',
      status: 'running',
      assigned_port: 10001,
      container_id: 'abc123def4567890',
      container_name: 'ol-app',
      container_port: 3000,
      health_check_path: '/healthz',
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:00:00.000Z',
      archived_at: null,
      server_id: 'local',
    };
    const execSimple = vi.fn(async () => ({ exitCode: 0, stdout: 'OK', stderr: '' }));
    const ctx = {
      db: {
        getProject: vi.fn(() => project),
        getProjectByName: vi.fn(() => project),
        getService: vi.fn(() => service),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({})),
        getDeployLogs: vi.fn(async () => []),
        resolveAiOpsPendingInputsForServiceKeys: vi.fn(async () => 0),
      },
      pipeline: { getLogs: vi.fn(async () => '') },
      docker: {
        inspectContainer: vi.fn(async () => ({
          Name: '/ol-app',
          State: { Running: true, Status: 'running', StartedAt: '2026-05-13T00:00:00.000Z' },
          Config: { Image: 'app:latest' },
        })),
        execSimple,
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: 'app__svc', internal: true, service_id: 'svc-1' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    // exec was called against the SERVICE container (not the backend),
    // and the command targets the service's container_port (3000), not
    // the host-side assigned_port (10001).
    expect(execSimple).toHaveBeenCalledTimes(1);
    expect(execSimple.mock.calls[0][0]).toBe('abc123def4567890');
    expect(execSimple.mock.calls[0][1][2]).toContain('127.0.0.1:3000/healthz');

    const httpCheck = result.httpCheck as Record<string, unknown>;
    expect(httpCheck).toMatchObject({
      reachable: true,
      probed_from: 'service-container',
      protocol_used: 'http',
    });
    expect(httpCheck.target_resolved).toContain(':3000/healthz');
    expect(httpCheck.target_resolved).toContain('abc123def456');
  });

  it('reports skipped when internal=true is requested before container_id exists', async () => {
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const service = {
      id: 'app__svc',
      project_id: 'app',
      name: 'web',
      kind: 'git',
      source: 'git',
      status: 'starting',
      assigned_port: 10001,
      container_id: null,
      container_name: null,
      container_port: 3000,
      health_check_path: '/',
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:00:00.000Z',
      archived_at: null,
      server_id: 'local',
    };
    const execSimple = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const ctx = {
      db: {
        getProject: vi.fn(() => project),
        getProjectByName: vi.fn(() => project),
        getService: vi.fn(() => service),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({})),
        getDeployLogs: vi.fn(async () => []),
        resolveAiOpsPendingInputsForServiceKeys: vi.fn(async () => 0),
      },
      pipeline: { getLogs: vi.fn(async () => '') },
      docker: {
        inspectContainer: vi.fn(async () => ({})),
        execSimple,
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: 'app__svc', internal: true, service_id: 'svc-1' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(execSimple).not.toHaveBeenCalled();
    expect(result.httpCheck).toMatchObject({
      skipped: true,
      reason: expect.stringContaining('container_id'),
    });
  });
});

describe('service-targeted monitoring tools', () => {
  function createServiceTargetContext() {
    const project = { id: 'app', name: 'app', status: 'running', container_id: 'legacy-container' };
    const service = {
      id: 'app__svc',
      project_id: 'app',
      name: 'web',
      kind: 'git',
      source: 'git',
      status: 'running',
      assigned_port: 10001,
      container_id: 'service-container' as string | null,
      container_name: 'ol-app' as string | null,
      container_port: 3000,
      health_check_path: '/health',
      repo_url: 'https://github.com/acme/app.git',
      branch: 'main',
      image_tag: 'app:latest' as string | null,
      image_url: null as string | null,
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
        getServices: vi.fn(async (query?: { ids?: string[] }) =>
          query?.ids?.includes(service.id) ? [service] : [],
        ),
        getDeployableForProject: vi.fn(async (id: string) =>
          id === project.id ? service : undefined,
        ),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        listDomainMappingsForService: vi.fn(async () => []),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({ NODE_ENV: 'production' })),
        getDeployLogs: vi.fn(async () => []),
        getAiOpsBriefing: vi.fn(async () => null),
        upsertAiOpsPendingInput: vi.fn(async (input: Record<string, unknown>) => ({
          id: 'pending-1',
          project_id: input['projectId'],
          service_id: input['serviceId'],
          briefing_id: input['briefingId'] ?? null,
          field: input['field'],
          reason: input['reason'],
          source_required: 'user',
          status: 'pending',
          created_at: '2026-06-18T00:00:00.000Z',
          updated_at: '2026-06-18T00:00:00.000Z',
          resolved_at: null,
        })),
        resolveAiOpsPendingInputsForServiceKeys: vi.fn(async () => 0),
      },
      pipeline: {
        getLogs: vi.fn(async () => 'service logs'),
      },
      docker: {
        getContainerStats: vi.fn(async () => ({
          cpu_stats: {
            cpu_usage: { total_usage: 300, percpu_usage: [1, 2] },
            system_cpu_usage: 1000,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 100 },
            system_cpu_usage: 500,
          },
          memory_stats: { usage: 104857600, limit: 536870912 },
        })),
        inspectContainer: vi.fn(async () => ({
          Name: '/ol-app',
          State: {
            Running: true,
            Status: 'running',
            ExitCode: 0,
            Error: '',
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            FinishedAt: '0001-01-01T00:00:00Z',
          },
          Config: { Image: 'app:latest' },
          RestartCount: 2,
        })),
        listManagedContainers: vi.fn(async () => [{ id: 'service-container', status: 'running' }]),
        execSimple: vi.fn(async () => ({ exitCode: 0, stdout: 'OK', stderr: '' })),
      },
    } as unknown as AppContext;
    return { ctx, project, service };
  }

  it('get_logs accepts deployable service_id from list_projects output', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { service_id: service.id, lines: 7 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 7);
    expect(result).toMatchObject({
      project: 'app',
      service: {
        id: service.id,
        name: service.name,
      },
      logs: 'service logs',
    });
  });

  it('get_logs returns a stable service field for project_name targets', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { project_name: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.getServices).toHaveBeenCalledWith({ ids: ['app__svc'] });
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 5);
    expect(result).toMatchObject({
      project: 'app',
      service: {
        id: service.id,
        name: service.name,
      },
      logs: 'service logs',
    });
  });

  it('get_logs accepts project_id targets', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { project_id: 'app', lines: 6 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.getProject).toHaveBeenCalledWith('app');
    expect(ctx.db.getServices).toHaveBeenCalledWith({ ids: ['app__svc'] });
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 6);
    expect(result).toMatchObject({
      service: { id: service.id },
      logs: 'service logs',
    });
  });

  it('get_logs accepts a project group name through service_name when unambiguous', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { service_name: 'app', lines: 4 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 4);
    expect(result).toMatchObject({
      project: 'app',
      service: { id: service.id, name: service.name },
      logs: 'service logs',
    });
  });

  it('get_logs resolves deployable services by Docker container name', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { container_name: 'ol-app', lines: 9 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.listServices).toHaveBeenCalled();
    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 9);
    expect(result).toMatchObject({
      project: 'app',
      service: {
        id: service.id,
        name: service.name,
        container_name: 'ol-app',
      },
      logs: 'service logs',
    });
  });

  it('get_logs accepts container names through service_name for CLI-style calls', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_logs').execute(
      { service_name: 'ol-app', lines: 8 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.pipeline.getLogs).toHaveBeenCalledWith('app', 8);
    expect(result).toMatchObject({
      service: { id: service.id },
      logs: 'service logs',
    });
  });

  it('get_project_stats accepts deployable service_id from list_projects output', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_project_stats').execute(
      { service_id: service.id },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.docker.getContainerStats).toHaveBeenCalledWith('service-container');
    expect(result).toMatchObject({
      project: 'app',
      service: {
        id: service.id,
        name: service.name,
      },
      status: 'running',
      memory_usage_mb: 100,
      memory_limit_mb: 512,
      restarts: 2,
    });
  });

  it('get_project_stats accepts project_id targets', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'get_project_stats').execute(
      { project_id: 'app' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.docker.getContainerStats).toHaveBeenCalledWith('service-container');
    expect(result).toMatchObject({
      service: { id: service.id },
      status: 'running',
    });
    expect(ctx.db.getServices).toHaveBeenCalledWith({ ids: ['app__svc'] });
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('get_topology returns deployable and managed dependency nodes', async () => {
    const project = { id: 'app', name: 'app', status: 'running' };
    const appService = {
      id: 'app__svc',
      project_id: 'app',
      name: 'web',
      kind: 'git',
      source: 'git',
      status: 'running',
      assigned_port: 10001,
      image_url: 'app:latest',
    };
    const postgres = {
      id: 'svc-pg',
      project_id: 'app',
      name: 'app-postgres',
      kind: 'postgres',
      type: null,
      status: 'running',
      assigned_port: 5432,
      image_url: 'postgres:17-alpine',
    };
    const redis = {
      id: 'svc-redis',
      project_id: 'app',
      name: 'app-redis',
      kind: 'redis',
      type: 'redis',
      status: 'running',
      assigned_port: 6379,
      image_url: 'redis:8-alpine',
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [appService]),
        getDeployableForProject: vi.fn(async () => appService),
        getServices: vi.fn(async () => [postgres]),
        listServiceConnectionsByProject: vi.fn(async () => [
          {
            service_id_consumer: 'app__svc',
            service_id_provider: 'svc-redis',
          },
        ]),
        listServices: vi.fn(async () => [appService, postgres, redis]),
        findDependenciesByProject: vi.fn(async () => [{ target_service_id: 'svc-pg' }]),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'get_topology').execute(
      { project_id: 'app' },
      { target: 'mcp' },
    )) as {
      project: { id: string; name: string };
      count: number;
      services: Array<{ id: string; role: string; type?: string; dependsOn: string[] }>;
      edges: Array<{ from: string; to: string }>;
    };

    expect(result.project).toEqual({ id: 'app', name: 'app' });
    expect(result.count).toBe(3);
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app__svc',
          role: 'deployable',
          dependsOn: ['svc-pg', 'svc-redis'],
        }),
        expect.objectContaining({
          id: 'svc-pg',
          role: 'managed',
          type: 'postgresql',
        }),
        expect.objectContaining({
          id: 'svc-redis',
          role: 'managed',
          type: 'redis',
        }),
      ]),
    );
    expect(result.edges).toEqual([
      { from: 'app__svc', to: 'svc-pg' },
      { from: 'app__svc', to: 'svc-redis' },
    ]);
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('get_topology expands Compose stacks into internal container nodes', async () => {
    const project = { id: 'stack', name: 'demo-stack', status: 'running' };
    const composeParent = {
      id: 'stack__svc',
      project_id: 'stack',
      name: 'demo-stack__svc',
      kind: 'compose',
      source: 'git',
      status: 'running',
      assigned_port: null,
      image_url: 'demo-stack:latest',
    };
    const web = {
      id: 'stack__web__svc',
      project_id: 'stack',
      name: 'demo-stack/web__svc',
      kind: 'compose-child',
      source: 'git',
      status: 'running',
      assigned_port: 10001,
      image_url: 'demo-stack-web:latest',
    };
    const postgres = {
      id: 'stack__postgres__svc',
      project_id: 'stack',
      name: 'demo-stack/postgres__svc',
      kind: 'compose-child',
      source: 'git',
      status: 'running',
      assigned_port: 10002,
      image_url: 'postgres:17-alpine',
    };
    const redis = {
      id: 'stack__redis__svc',
      project_id: 'stack',
      name: 'demo-stack/redis__svc',
      kind: 'compose-child',
      source: 'git',
      status: 'running',
      assigned_port: 10003,
      image_url: 'redis:8-alpine',
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [composeParent]),
        getComposeChildren: vi.fn(async () => [web, postgres, redis]),
        getServices: vi.fn(async () => []),
        listServiceConnectionsByProject: vi.fn(async () => []),
        listServices: vi.fn(async () => [composeParent, web, postgres, redis]),
        findDependenciesByProject: vi.fn(async (projectId: string) =>
          projectId === 'stack__web'
            ? [
                { target_service_id: 'stack__postgres__svc' },
                { target_service_id: 'stack__redis__svc' },
              ]
            : [],
        ),
      },
    } as unknown as AppContext;

    const result = (await getMonitoringTool(ctx, 'get_topology').execute(
      { project_id: 'stack' },
      { target: 'mcp' },
    )) as {
      count: number;
      services: Array<{ id: string; kind: string; dependsOn: string[] }>;
      edges: Array<{ from: string; to: string }>;
    };

    expect(ctx.db.getComposeChildren).toHaveBeenCalledWith('stack__svc');
    expect(result.count).toBe(3);
    expect(result.services.map((service) => service.id)).toEqual([
      'stack__web__svc',
      'stack__postgres__svc',
      'stack__redis__svc',
    ]);
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'stack__web__svc',
          kind: 'compose',
          dependsOn: ['stack__postgres__svc', 'stack__redis__svc'],
        }),
      ]),
    );
    expect(result.edges).toEqual([
      { from: 'stack__web__svc', to: 'stack__postgres__svc' },
      { from: 'stack__web__svc', to: 'stack__redis__svc' },
    ]);
  });

  it('get_project_stats points agents at explicit target parameters', () => {
    const { ctx } = createServiceTargetContext();
    const tool = getMonitoringTool(ctx, 'get_project_stats');
    const parsed = tool.inputSchema.safeParse({ project: 'app' });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        'service_id, service_name, project_id, project_name, or container_name is required',
      );
    }
  });

  it('diagnose_service caps normalized evidence and records omitted follow-up calls', async () => {
    const { ctx, service } = createServiceTargetContext();
    const longLog = Array.from({ length: 900 }, (_, index) => `runtime line ${String(index)}`).join(
      '\n',
    );
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce(longLog);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: service.id, lines: 900 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.recentLogTail).toContain('truncated by OpenLander evidence cap');
    expect(evidence.recentLogTail).not.toContain('runtime line 899');
    const metadata = result.evidence_metadata as {
      input_cap_applied: boolean;
      omitted_evidence: Array<{
        path: string;
        follow_up_call?: { tool?: string; action?: string; params?: Record<string, unknown> };
      }>;
    };
    expect(metadata.input_cap_applied).toBe(true);
    expect(metadata.omitted_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'recentLogTail',
          follow_up_call: {
            tool: 'openlander_monitor',
            action: 'get_logs',
            params: { service_id: service.id, lines: 500 },
          },
        }),
      ]),
    );
  });

  it('diagnose_service returns a recovery receipt when a briefing_id is supplied', async () => {
    const { ctx, service } = createServiceTargetContext();
    vi.mocked(ctx.db.getAiOpsBriefing).mockResolvedValueOnce(
      makeAiOpsBriefingRow({
        id: 'brief-restart',
        project_id: 'app',
        service_id: service.id,
        created_at: '2026-06-13T12:00:00.000Z',
        evidence_json: JSON.stringify({
          routeHealth: { status: 'unhealthy', statusCode: 502 },
          container: {
            running: false,
            status: 'exited',
            exitCode: 137,
            restartCount: 4,
          },
          deployLog: {
            id: 'deploy-before',
            status: 'failed',
            commitSha: 'badcafe',
          },
        }),
      }),
    );
    vi.mocked(ctx.db.getDeployLogs).mockResolvedValueOnce([
      {
        id: 'deploy-after',
        service_id: service.id,
        environment_id: null,
        status: 'success',
        trigger: 'api',
        trigger_detail: null,
        commit_sha: 'goodcafe',
        commit_message: 'fix startup',
        build_log: 'Build completed',
        runtime_log: null,
        duration_ms: 5000,
        created_at: '2026-06-13T12:05:00.000Z',
        representative_traffic_json: null,
      },
    ]);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: service.id, briefing_id: 'brief-restart', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.getAiOpsBriefing).toHaveBeenCalledWith('brief-restart');
    const receipt = result.recovery_receipt as Record<string, unknown>;
    expect(receipt).toMatchObject({
      briefing_id: 'brief-restart',
      project_id: 'app',
      service_id: service.id,
      status: 'verified',
      summary: 'OpenLander verified the live route, container, restart, and latest deploy checks.',
      report_to_user:
        'OpenLander verified the live recovery checks. You can resolve the ticket when you agree the incident is done.',
      next_action:
        'Report the verified receipt to the user. The user can manually resolve the ticket if they agree the incident is done.',
      can_resolve: true,
      passed_checks: ['route_health', 'container_status', 'restart_stability', 'latest_deploy'],
      failed_checks: [],
      unknown_checks: [],
      baseline_observed_at: '2026-06-13T12:00:00.000Z',
    });
    expect(receipt._agent_guidance).toMatchObject({
      next_steps: [receipt.next_action],
    });
    expect(receipt.primary_check).toMatchObject({
      name: 'latest_deploy',
      status: 'pass',
      label: 'Latest deploy status',
      severity: 'info',
      reason: expect.stringContaining('deploy-status evidence'),
    });
    expect(receipt.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'route_health',
          status: 'pass',
          label: 'Route health',
          severity: 'info',
          reason: 'The live route health check is healthy.',
          before: { status: 'unhealthy', status_code: 502 },
          after: { status: 'healthy' },
        }),
        expect.objectContaining({
          name: 'container_status',
          status: 'pass',
          after: expect.objectContaining({ running: true, status: 'running' }),
        }),
        expect.objectContaining({
          name: 'restart_stability',
          status: 'pass',
          before: { restart_count: 4 },
          after: expect.objectContaining({ restart_count: 2, status: 'running' }),
        }),
        expect.objectContaining({
          name: 'latest_deploy',
          status: 'pass',
          label: 'Latest deploy status',
          severity: 'info',
          reason: expect.stringContaining('deploy-status evidence'),
          before: { id: 'deploy-before', status: 'failed', commit_sha: 'badcafe' },
          after: { id: 'deploy-after', status: 'success', commit_sha: 'goodcafe' },
          changed: true,
        }),
      ]),
    );
    expect(receipt.check_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'latest_deploy',
          label: 'Latest deploy status',
          status: 'pass',
          severity: 'info',
          reason: expect.stringContaining('deploy-status evidence'),
        }),
      ]),
    );
  });

  it('diagnose_service recovery receipt highlights failing latest deploy evidence', async () => {
    const { ctx, service } = createServiceTargetContext();
    vi.mocked(ctx.db.getAiOpsBriefing).mockResolvedValueOnce(
      makeAiOpsBriefingRow({
        id: 'brief-deploy-failed',
        project_id: 'app',
        service_id: service.id,
        evidence_json: JSON.stringify({
          routeHealth: { status: 'unhealthy', statusCode: 502 },
          container: {
            running: true,
            status: 'running',
            restartCount: 2,
          },
          deployLog: {
            id: 'deploy-before',
            status: 'failed',
            commitSha: 'badcafe',
          },
        }),
      }),
    );
    vi.mocked(ctx.db.getDeployLogs).mockResolvedValueOnce([
      {
        id: 'deploy-after',
        service_id: service.id,
        environment_id: null,
        status: 'failed',
        trigger: 'api',
        trigger_detail: null,
        commit_sha: 'stillbad',
        commit_message: 'attempted fix',
        build_log: 'Build failed',
        runtime_log: null,
        duration_ms: 5000,
        created_at: '2026-06-13T12:05:00.000Z',
        representative_traffic_json: null,
      },
    ]);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: service.id, briefing_id: 'brief-deploy-failed', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    const receipt = result.recovery_receipt as Record<string, unknown>;
    expect(receipt).toMatchObject({
      status: 'needs_attention',
      can_resolve: false,
      passed_checks: ['route_health', 'container_status', 'restart_stability'],
      failed_checks: ['latest_deploy'],
      unknown_checks: [],
      summary: 'OpenLander still sees a failing recovery check: Latest deploy status.',
      report_to_user: expect.stringContaining('The latest deploy is still failed or unhealthy'),
      next_action:
        'Do not resolve the ticket yet. Investigate Latest deploy status and run diagnose_service again after the fix.',
    });
    expect(receipt._agent_guidance).toMatchObject({
      next_steps: [receipt.next_action],
    });
    expect(receipt.primary_check).toMatchObject({
      name: 'latest_deploy',
      status: 'fail',
      label: 'Latest deploy status',
      severity: 'critical',
      reason:
        'The latest deploy is still failed or unhealthy, so OpenLander cannot verify the fix.',
    });
    expect(receipt.check_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'latest_deploy',
          label: 'Latest deploy status',
          status: 'fail',
          severity: 'critical',
          reason:
            'The latest deploy is still failed or unhealthy, so OpenLander cannot verify the fix.',
        }),
      ]),
    );
  });

  it('diagnose_service recovery receipt surfaces unknown checks without allowing resolve', async () => {
    const { ctx, service } = createServiceTargetContext();
    vi.mocked(ctx.db.getAiOpsBriefing).mockResolvedValueOnce(
      makeAiOpsBriefingRow({
        id: 'brief-unknown',
        project_id: 'app',
        service_id: service.id,
        evidence_json: JSON.stringify({
          routeHealth: { status: 'unhealthy', statusCode: 502 },
          container: {
            running: false,
            status: 'exited',
            restartCount: 4,
          },
        }),
      }),
    );

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_id: service.id, briefing_id: 'brief-unknown', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    const receipt = result.recovery_receipt as Record<string, unknown>;
    expect(receipt).toMatchObject({
      status: 'unknown',
      can_resolve: false,
      passed_checks: ['route_health', 'container_status', 'restart_stability'],
      failed_checks: [],
      unknown_checks: ['latest_deploy'],
      summary:
        'OpenLander could not fully verify recovery because Latest deploy status is missing or inconclusive.',
      report_to_user: expect.stringContaining(
        'OpenLander does not have enough latest deploy evidence',
      ),
      next_action:
        'Do not claim the incident is fixed yet. Gather more evidence for Latest deploy status and run diagnose_service again.',
    });
    expect(receipt._agent_guidance).toMatchObject({
      next_steps: [receipt.next_action],
    });
    expect(receipt.primary_check).toMatchObject({
      name: 'latest_deploy',
      status: 'unknown',
      label: 'Latest deploy status',
      severity: 'warning',
    });
  });

  it('diagnose_service accepts project_id targets', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.getProject).toHaveBeenCalledWith('app');
    expect(result).toMatchObject({
      service: { id: service.id },
      httpCheck: {
        probe_mode: 'internal_docker_dns',
        target_resolved: 'http://ol-app:3000/health',
      },
    });
  });

  it('diagnose_service calls out restart loops before HTTP probe guidance', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.docker.inspectContainer).mockResolvedValueOnce({
      Name: '/ol-app',
      State: {
        Running: true,
        Restarting: true,
        Status: 'restarting',
        ExitCode: 1,
        Error: '',
        StartedAt: new Date(Date.now() - 10_000).toISOString(),
        FinishedAt: new Date(Date.now() - 8_000).toISOString(),
      },
      Config: { Image: 'app:latest' },
      RestartCount: 4,
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;
    const guidance = result['_agent_guidance'] as { next_steps?: string[] };

    expect(result.container).toMatchObject({
      running: true,
      status: 'restarting',
      exitCode: 1,
      restartCount: 4,
    });
    expect(guidance.next_steps).toEqual(
      expect.arrayContaining([expect.stringContaining('restart loop')]),
    );
    expect(guidance.next_steps).not.toEqual(
      expect.arrayContaining([expect.stringContaining('HTTP probe failed')]),
    );
  });

  it('diagnose_service treats repeated restarts as a restart loop even when Docker says running', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.docker.inspectContainer).mockResolvedValueOnce({
      Name: '/ol-app',
      State: {
        Running: true,
        Restarting: false,
        Status: 'running',
        ExitCode: 0,
        Error: '',
        StartedAt: new Date(Date.now() - 10_000).toISOString(),
        FinishedAt: '0001-01-01T00:00:00Z',
      },
      Config: { Image: 'app:latest' },
      RestartCount: 7,
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      container: {
        running: true,
        status: 'running',
        restartCount: 7,
      },
      diagnosis: {
        code: 'RESTART_LOOP',
        confidence: 'high',
        evidence: { restart_count: 7 },
      },
    });
  });

  it('diagnose_service does not call old restarts a restart loop after the app stabilizes', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.docker.inspectContainer).mockResolvedValueOnce({
      Name: '/ol-app',
      State: {
        Running: true,
        Restarting: false,
        Status: 'running',
        ExitCode: 0,
        Error: '',
        StartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        FinishedAt: '0001-01-01T00:00:00Z',
      },
      Config: { Image: 'app:latest' },
      RestartCount: 7,
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result.container).toMatchObject({
      running: true,
      status: 'running',
      restartCount: 7,
    });
    expect(result['diagnosis']).toBeUndefined();
    expect(result['suggested_call']).toBeUndefined();
  });

  it('diagnose_service synthesizes port mismatch with apply_route_config suggested_call', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Server listening on port 4000');
    vi.mocked(ctx.docker.execSimple).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused',
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      diagnosis: {
        code: 'PORT_MISMATCH',
        confidence: 'high',
        evidence: {
          configured_container_port: 3000,
          detected_listening_port: 4000,
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: 'app__svc', container_port: 4000 },
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('route_verification')]),
      },
    });
  });

  it('diagnose_service keeps internalHttpCheck for Docker DNS route failures', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('service logs');
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'bad gateway' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.docker.execSimple).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      httpCheck: {
        reachable: false,
        probe_mode: 'internal_docker_dns',
      },
      internalHttpCheck: {
        reachable: true,
        probed_from: 'service-container',
      },
      route: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'external_route_failed_internal_probe_passed' }),
        ]),
      },
    });
  });

  it('diagnose_service does not let host-port fallback hide a container port mismatch', async () => {
    const { ctx, service } = createServiceTargetContext();
    (service as { container_name: string | null }).container_name = null;
    service.container_port = 9999;
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('urlnest listening on 3000');
    vi.mocked(ctx.docker.execSimple).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused',
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      httpCheck: {
        reachable: false,
        probe_mode: 'service_container_loopback',
      },
      diagnosis: {
        code: 'PORT_MISMATCH',
        confidence: 'high',
        evidence: {
          configured_container_port: 9999,
          detected_listening_port: 3000,
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: 'app__svc', container_port: 3000 },
      },
    });
  });

  it('diagnose_service suppresses duplicate internalHttpCheck after service-container loopback', async () => {
    const { ctx, service } = createServiceTargetContext();
    (service as { container_name: string | null }).container_name = null;
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('service logs');
    vi.mocked(ctx.docker.execSimple).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused',
    });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.docker.execSimple).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      httpCheck: {
        reachable: false,
        probe_mode: 'service_container_loopback',
        probed_from: 'service-container',
      },
    });
    expect(result['internalHttpCheck']).toBeUndefined();
  });

  it('diagnose_service keeps PORT_MISMATCH when APP_BASE_URL is unreachable', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://ledgerly.example.com',
    });
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Server listening on port 4000');
    vi.mocked(ctx.docker.execSimple).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND ledgerly.example.com');
    });

    try {
      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { project_id: 'app', lines: 5 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        dependencies: { count: 0, checks: [] },
        diagnosis: {
          code: 'PORT_MISMATCH',
          confidence: 'high',
          evidence: {
            configured_container_port: 3000,
            detected_listening_port: 4000,
          },
        },
        suggested_call: {
          tool: 'openlander_service',
          action: 'apply_route_config',
          params: { service_id: 'app__svc', container_port: 4000 },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnose_service does not diagnose self public URL failures as dependencies', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://ledgerly.example.com',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND ledgerly.example.com');
    });

    try {
      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { project_id: 'app', lines: 5 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result['diagnosis']).toBeUndefined();
      expect(result['suggested_call']).toBeUndefined();
      expect(result).toMatchObject({
        dependencies: { count: 0, checks: [] },
        httpCheck: expect.objectContaining({ reachable: true }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnose_service excludes managed public route hosts from dependency diagnosis', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.listDomainMappingsForService).mockResolvedValueOnce([
      {
        id: 'domain-1',
        service_id: 'app__svc',
        domain: 'app.example.com',
        cloudflare_zone_id: null,
        cloudflare_dns_record_id: null,
        status: 'active',
        path_prefix: '/',
        strip_prefix: false,
        upstream_path_prefix: null,
        target_port: null,
        tls_enabled: null,
        tls_resolver: null,
        created_at: '2026-06-04T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      API_URL: 'https://app.example.com/api',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND app.example.com');
    });

    try {
      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { project_id: 'app', lines: 5 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result['diagnosis']).toBeUndefined();
      expect(result).toMatchObject({
        dependencies: { count: 0, checks: [] },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnose_service does not blame dependencies when the service container is unavailable', async () => {
    const { ctx, service } = createServiceTargetContext();
    service.container_id = 'missing-container';
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://db.example.com:5432/app',
    });
    vi.mocked(ctx.docker.inspectContainer).mockRejectedValueOnce(new Error('No such container'));

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      dependencies: {
        checks: [
          expect.objectContaining({
            key: 'DATABASE_URL',
            reachable: false,
          }),
        ],
      },
      diagnosis: {
        code: 'CONTAINER_NOT_RUNNING',
        confidence: 'high',
        evidence: {
          present: false,
          error: 'No such container',
        },
      },
    });
    expect(JSON.stringify(result['diagnosis'])).not.toContain('DEPENDENCY_UNREACHABLE');
  });

  it('diagnose_service still reports real dependency failures', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://db.example.com:5432/app',
    });
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'connection refused' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      dependencies: {
        count: 1,
        checks: [
          expect.objectContaining({
            key: 'DATABASE_URL',
            reachable: false,
          }),
        ],
      },
      diagnosis: {
        code: 'DEPENDENCY_UNREACHABLE',
        confidence: 'high',
        recoverability: 'needs_user_input',
        agent_terminal: true,
        input_required: {
          field: 'DATABASE_URL',
          source_required: 'user',
        },
        report_to_user: {
          status: 'needs_user_input',
          required_input: {
            field: 'DATABASE_URL',
          },
        },
        evidence: {
          key: 'DATABASE_URL',
        },
      },
    });
    expect(result['suggested_call']).toBeUndefined();
    expect(result).toMatchObject({
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          expect.stringContaining('Do not guess or invent DATABASE_URL'),
        ]),
      },
    });
    expect(ctx.db.upsertAiOpsPendingInput).toHaveBeenCalledWith({
      projectId: 'app',
      serviceId: 'app__svc',
      briefingId: null,
      field: 'DATABASE_URL',
      reason: 'The saved DATABASE_URL endpoint is unreachable from the service network.',
    });
  });

  it('diagnose_service does not create pending input for OpenLander-managed dependency hosts', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://ol-svc-postgres:5432/app',
    });
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'connection refused' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      diagnosis: {
        code: 'DEPENDENCY_UNREACHABLE',
        recoverability: 'needs_user_input',
        input_required: { field: 'DATABASE_URL' },
      },
    });
    expect(ctx.db.upsertAiOpsPendingInput).not.toHaveBeenCalled();
  });

  it('diagnose_service keeps HTTP non-2xx dependency evidence without high-confidence network diagnosis', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      EXCHANGE_API_URL: 'https://api.exchange.test:443',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('bad request', { status: 400 }));

    try {
      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { project_id: 'app', lines: 5 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        dependencies: {
          count: 1,
          checks: [
            expect.objectContaining({
              key: 'EXCHANGE_API_URL',
              protocol: 'https',
              reachable: false,
              status_code: 400,
            }),
          ],
        },
      });
      expect(result['diagnosis']).toBeUndefined();
      expect(result['suggested_call']).toBeUndefined();
      expect(JSON.stringify(result['_agent_guidance'] ?? {})).not.toContain(
        'declared dependency endpoints are unreachable',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnose_service omits diagnosis for healthy ambiguous output and keeps raw fields', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Server listening on port 3000');

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result['diagnosis']).toBeUndefined();
    expect(result['suggested_call']).toBeUndefined();
    expect(result).toMatchObject({
      env: expect.objectContaining({ masked: true }),
      logs: expect.objectContaining({ available: true }),
      httpCheck: expect.objectContaining({ reachable: true }),
      route: expect.objectContaining({
        provider: 'traefik_http',
        consistent: true,
      }),
    });
  });

  it('diagnose_service warns when healthcheck passes but representative traffic returns 5xx', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '200', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '500', stderr: '' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      httpCheck: {
        reachable: true,
        status_code: 200,
        target_resolved: 'http://ol-app:3000/health',
      },
      trafficCheck: {
        reachable: false,
        status_code: 500,
        target_resolved: 'http://ol-app:3000/',
      },
      warnings: [
        {
          code: 'TRAFFIC_HEALTH_MISMATCH',
          severity: 'warning',
          confidence: 'medium',
          evidence: {
            health_path: '/health',
            health_status_code: 200,
            traffic_path: '/',
            traffic_status_code: 500,
          },
        },
      ],
      diagnosis: {
        code: 'TRAFFIC_HEALTH_MISMATCH',
        confidence: 'medium',
        evidence: {
          source: 'live_probe',
          health_path: '/health',
          health_status_code: 200,
          traffic_path: '/',
          traffic_status_code: 500,
        },
      },
      _agent_guidance: {
        message: expect.stringContaining('Health path /health is reachable'),
        next_steps: expect.arrayContaining([
          expect.stringContaining('representative traffic returned 5xx'),
        ]),
      },
    });
    expect(result['suggested_call']).toBeUndefined();
  });

  it('diagnose_service prefers runtime env diagnosis over representative traffic symptoms', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Error: DATABASE_URL is not set');
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '200', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '500', stderr: '' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      warnings: [{ code: 'TRAFFIC_HEALTH_MISMATCH' }],
      diagnosis: {
        code: 'RUNTIME_ENV_MISSING',
        confidence: 'high',
        evidence: {
          missing_env_keys: ['DATABASE_URL'],
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'set_env_vars',
      },
    });
  });

  it('diagnose_service prefers dependency diagnosis over representative traffic symptoms', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://db.example.com:5432/app',
    });
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '200', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '500', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'connection refused' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      warnings: [{ code: 'TRAFFIC_HEALTH_MISMATCH' }],
      diagnosis: {
        code: 'DEPENDENCY_UNREACHABLE',
        confidence: 'high',
        recoverability: 'needs_user_input',
        agent_terminal: true,
        input_required: {
          field: 'DATABASE_URL',
          source_required: 'user',
        },
        report_to_user: {
          status: 'needs_user_input',
        },
        evidence: {
          key: 'DATABASE_URL',
        },
      },
    });
    expect(result['suggested_call']).toBeUndefined();
  });

  it('diagnose_service includes persisted representative traffic evidence from recent deploys', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getDeployLogs).mockResolvedValueOnce([
      {
        id: 'deploy-traffic',
        service_id: 'app__svc',
        environment_id: null,
        status: 'success',
        trigger: 'api',
        trigger_detail: null,
        commit_sha: 'abc123',
        commit_message: 'ship',
        build_log: null,
        runtime_log: null,
        representative_traffic_json: JSON.stringify({
          status: 'failed',
          severity: 'fail',
          path: '/',
          status_code: 500,
          attempts: 2,
          elapsed_ms: 1200,
          message: 'Route probe returned HTTP 500',
        }),
        duration_ms: 2000,
        created_at: '2026-05-22T00:00:00Z',
      },
    ]);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      recentDeployment: {
        latest: {
          id: 'deploy-traffic',
          status: 'success',
          effectiveStatus: 'unhealthy',
          effectiveStatusReason: 'representative_traffic_failed',
          representativeTraffic: {
            status: 'failed',
            severity: 'fail',
            path: '/',
            status_code: 500,
            message: 'Route probe returned HTTP 500',
          },
        },
        history: [
          {
            id: 'deploy-traffic',
            status: 'success',
            effectiveStatus: 'unhealthy',
            representativeTraffic: {
              status: 'failed',
              severity: 'fail',
              path: '/',
              status_code: 500,
            },
          },
        ],
      },
      diagnosis: {
        code: 'TRAFFIC_HEALTH_MISMATCH',
        confidence: 'medium',
        evidence: {
          source: 'recent_deployment_representative_traffic',
          deploy_id: 'deploy-traffic',
          deploy_status: 'success',
          effective_status: 'unhealthy',
          path: '/',
          status_code: 500,
          message: 'Route probe returned HTTP 500',
        },
      },
    });
  });

  it('diagnose_service does not let persisted traffic evidence mask current port mismatch', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('App listening on port 4000');
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'bad gateway' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'connection refused' });
    vi.mocked(ctx.db.getDeployLogs).mockResolvedValueOnce([
      {
        id: 'deploy-traffic',
        service_id: 'app__svc',
        environment_id: null,
        status: 'success',
        trigger: 'api',
        trigger_detail: null,
        commit_sha: 'abc123',
        commit_message: 'ship',
        build_log: null,
        runtime_log: null,
        representative_traffic_json: JSON.stringify({
          status: 'failed',
          severity: 'fail',
          path: '/',
          status_code: 500,
          message: 'Route probe returned HTTP 500',
        }),
        duration_ms: 2000,
        created_at: '2026-05-22T00:00:00Z',
      },
    ]);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      recentDeployment: {
        latest: {
          effectiveStatus: 'unhealthy',
          effectiveStatusReason: 'representative_traffic_failed',
        },
      },
      diagnosis: {
        code: 'PORT_MISMATCH',
        confidence: 'high',
        evidence: {
          configured_container_port: 3000,
          detected_listening_port: 4000,
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: 'app__svc', container_port: 4000 },
      },
    });
  });

  it.each([
    { statusCode: 401, exitCode: 0 },
    { statusCode: 403, exitCode: 0 },
    { statusCode: 404, exitCode: 0 },
    { statusCode: 302, exitCode: 0 },
  ])(
    'diagnose_service does not warn on ambiguous representative traffic HTTP $statusCode',
    async ({ statusCode, exitCode }) => {
      const { ctx } = createServiceTargetContext();
      vi.mocked(ctx.docker.execSimple)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '200', stderr: '' })
        .mockResolvedValueOnce({
          exitCode,
          stdout: String(statusCode),
          stderr: '',
        });

      const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
        { project_id: 'app', lines: 5 },
        { target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        httpCheck: { reachable: true, status_code: 200 },
        trafficCheck: { status_code: statusCode },
      });
      expect(result['warnings']).toBeUndefined();
      expect(result['diagnosis']).toBeUndefined();
    },
  );

  it('diagnose_service distinguishes runtime env missing and suggests same-image env apply', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Error: DATABASE_URL is not set');

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      diagnosis: {
        code: 'RUNTIME_ENV_MISSING',
        confidence: 'high',
        evidence: {
          missing_env_keys: ['DATABASE_URL'],
          missing_from_saved_env: ['DATABASE_URL'],
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'set_env_vars',
        params: {
          service_id: 'app__svc',
          scope: 'service',
          variables: { DATABASE_URL: '<DATABASE_URL_value>' },
          defer_redeploy: false,
        },
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('runtime_apply')]),
      },
    });
  });

  it('diagnose_service does not treat generic uppercase tokens as high-confidence env keys', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('TLS is required for outbound calls');

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result['diagnosis']).toBeUndefined();
    expect(result['suggested_call']).toBeUndefined();
  });

  it('diagnose_service distinguishes build-time env missing and suggests full redeploy', async () => {
    const { ctx } = createServiceTargetContext();
    vi.mocked(ctx.db.getEnvVarsForService).mockResolvedValueOnce({
      DATABASE_URL: 'postgres://app/db',
    });
    vi.mocked(ctx.db.getDeployLogs).mockResolvedValueOnce([
      {
        id: 'deploy-1',
        service_id: 'app__svc',
        environment_id: null,
        status: 'failed',
        trigger: 'api',
        trigger_detail: null,
        commit_sha: 'abc123',
        commit_message: 'test',
        build_log: 'Build failed: DATABASE_URL is not set',
        runtime_log: null,
        duration_ms: 12000,
        created_at: '2026-05-12T00:01:00.000Z',
      },
    ]);

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      diagnosis: {
        code: 'BUILD_TIME_ENV_MISSING',
        confidence: 'high',
        evidence: {
          suspected_missing_build_time_keys: ['DATABASE_URL'],
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_app',
        params: { service_id: 'app__svc' },
      },
    });
  });

  it('diagnose_service suggests full redeploy when runtime env apply has no image', async () => {
    const { ctx, service } = createServiceTargetContext();
    service.container_id = null;
    service.container_name = null;
    service.image_tag = null;
    service.image_url = null;
    vi.mocked(ctx.pipeline.getLogs).mockResolvedValueOnce('Missing env DATABASE_URL');

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      diagnosis: {
        code: 'NO_RUNTIME_IMAGE',
        confidence: 'high',
        evidence: {
          missing_env_keys: ['DATABASE_URL'],
          image_tag: null,
          image_url: null,
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_app',
        params: { service_id: 'app__svc' },
      },
    });
  });

  it('diagnose_service detects route backend mismatch and suggests route refresh', async () => {
    const { ctx, service } = createServiceTargetContext();
    service.container_name = 'ol-stale-app';
    vi.mocked(ctx.docker.inspectContainer).mockResolvedValueOnce({
      Name: '/ol-current-app',
      State: {
        Running: true,
        Status: 'running',
        ExitCode: 0,
        Error: '',
        StartedAt: new Date(Date.now() - 10_000).toISOString(),
        FinishedAt: '0001-01-01T00:00:00Z',
      },
      Config: { Image: 'app:latest' },
      RestartCount: 0,
    });
    vi.mocked(ctx.docker.execSimple)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'bad gateway' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK', stderr: '' });

    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      route: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'backend_container_name_mismatch' }),
          expect.objectContaining({ code: 'external_route_failed_internal_probe_passed' }),
        ]),
      },
      diagnosis: {
        code: 'ROUTE_BACKEND_MISMATCH',
        confidence: 'high',
        evidence: {
          repair_mode: 'refresh_http_provider_backend',
        },
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: 'app__svc', container_port: 3000 },
      },
    });
  });

  it('diagnose_service accepts health_check_path as a path alias', async () => {
    const { ctx } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { project_id: 'app', health_check_path: '/admin', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      httpCheck: {
        probe_mode: 'internal_docker_dns',
        target_resolved: 'http://ol-app:3000/admin',
      },
    });
  });

  it('diagnose_service accepts a project group name through service_name when unambiguous', async () => {
    const { ctx, service } = createServiceTargetContext();
    const result = (await getMonitoringTool(ctx, 'diagnose_service').execute(
      { service_name: 'app', lines: 5 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      service: { id: service.id },
      httpCheck: {
        probe_mode: 'internal_docker_dns',
        target_resolved: 'http://ol-app:3000/health',
      },
    });
  });
});

describe('mcp_action_status aliases', () => {
  it('accepts action_id as an alias for action_run_id', async () => {
    const getActionRun = vi.fn(async () => ({
      id: 'action-run-1',
      project_id: 'project-1',
      status: 'pending_approval',
      approval_status: 'approved',
      approval_tool: 'destructive_mcp',
      error_message: null,
      approval_requested_at: '2026-05-05T00:00:00.000Z',
      approval_resolved_at: '2026-05-05T00:01:00.000Z',
    }));
    const ctx = {
      db: {
        getActionRun,
      },
    } as unknown as AppContext;
    const result = (await getMonitoringTool(ctx, 'mcp_action_status').execute(
      { action_id: 'action-run-1' },
      { target: 'mcp', appCtx: ctx },
    )) as Record<string, unknown>;

    expect(getActionRun).toHaveBeenCalledWith('action-run-1');
    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'approved_executing',
    });
  });
});
