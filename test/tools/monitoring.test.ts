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
      container_id: 'service-container',
      container_name: 'ol-app',
      container_port: 3000,
      health_check_path: '/health',
      repo_url: 'https://github.com/acme/app.git',
      branch: 'main',
      image_url: null,
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) =>
          id === project.id ? service : undefined,
        ),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getEnvVars: vi.fn(async () => ({})),
        getEnvVarsForService: vi.fn(async () => ({ NODE_ENV: 'production' })),
        getDeployLogs: vi.fn(async () => []),
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

    expect(ctx.db.getDeployableForProject).toHaveBeenCalledWith('app');
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
