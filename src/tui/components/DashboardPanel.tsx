import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { Spinner } from './Spinner.js';
import { theme } from '../theme.js';
import {
  PROJECT_STATUS_ICON,
  PROJECT_STATUS_COLOR,
  miniBar,
  getColorForPercent,
  formatMemory,
  formatUptime,
  truncate,
  formatTime,
  getActivityIcon,
  getActivityColor,
} from '../dashboard-utils.js';
import type {
  OpenLanderClient,
  Project,
  ActivityEvent,
  HealthResponse,
  ProjectStats,
} from '../../ipc/client.js';
import type { SystemStats } from '../../monitor/stats.js';

interface DashboardPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  onStatsUpdate?: (data: {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
  }) => void;
}

// Section header component
export function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <box>
      <text bold={true} fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>▸ </span>
        {title}
      </text>
    </box>
  );
}

// System section component
export function SystemSection({
  stats,
  health,
  loading,
}: {
  stats: SystemStats | null;
  health: HealthResponse | null;
  loading: boolean;
}): JSX.Element {
  if (loading && !stats) {
    return (
      <box flexDirection="column">
        <SectionHeader title="System" />
        <box paddingLeft={2} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>
            <Spinner color={theme.textMuted} />
          </text>
          <text fg={theme.textMuted}>Loading...</text>
        </box>
      </box>
    );
  }

  if (!stats) {
    return (
      <box flexDirection="column">
        <SectionHeader title="System" />
        <text fg={theme.textDim} paddingLeft={2}>
          Unavailable
        </text>
      </box>
    );
  }

  const cpuPercent = stats.cpu.usagePercent;
  const diskPercent = stats.disk.usagePercent;
  const dockerCount = health?.dockerContainers ?? 0;

  return (
    <box flexDirection="column">
      <SectionHeader title="System" />
      <box paddingLeft={2}>
        <text fg={theme.textMuted}>CPU </text>
        <text fg={getColorForPercent(cpuPercent)}>
          {String(Math.round(cpuPercent)).padStart(2)}%{' '}
        </text>
        <text fg={theme.textDim}>{miniBar(cpuPercent)}</text>
        <text fg={theme.textMuted}>
          {' '}
          MEM {formatMemory(stats.memory.usedMB)}/{formatMemory(stats.memory.totalMB)}GB
        </text>
      </box>
      <box paddingLeft={2}>
        <text fg={theme.textDim}>Disk {String(Math.round(diskPercent)).padStart(2)}%</text>
        <text fg={theme.textDim}> Docker {dockerCount} containers</text>
        <text fg={theme.textDim}> Uptime {formatUptime(stats.uptime.seconds)}</text>
      </box>
    </box>
  );
}

// Projects section component
export function ProjectsSection({
  projects,
  projectStats,
  selectedIndex,
  focus,
}: {
  projects: Project[];
  projectStats: Map<string, ProjectStats>;
  selectedIndex: number;
  focus: boolean;
}): JSX.Element {
  if (projects.length === 0) {
    return (
      <box flexDirection="column" marginTop={1}>
        <SectionHeader title="Projects (0)" />
        <text fg={theme.textDim} paddingLeft={2}>
          No projects yet
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <SectionHeader title={`Projects (${String(projects.length)})`} />
      <For each={projects}>
        {(project, index) => {
          const isSelected = focus && index() === selectedIndex;
          const icon = PROJECT_STATUS_ICON[project.status] ?? '?';
          const color = PROJECT_STATUS_COLOR[project.status] ?? 'white';
          const stats = projectStats.get(project.id);
          const memoryMB = stats?.memoryUsage ? Math.round(stats.memoryUsage / 1024 / 1024) : 0;
          const memoryStr = memoryMB > 0 ? `${String(memoryMB)}M` : '';
          const portStr = project.port ? `:${String(project.port)}` : '';
          const domain = project.publicUrl ?? project.url;

          return (
            <box flexDirection="column">
              <box paddingLeft={1}>
                {isSelected ? (
                  <text backgroundColor={theme.backgroundElement} fg={theme.secondary} bold={true}>
                    {' ▶ '}
                  </text>
                ) : (
                  <text fg={theme.textDim}>{'   '}</text>
                )}
                <text fg={color}>{icon} </text>
                <text fg={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
                  {truncate(project.name, 12).padEnd(12)}
                </text>
                <text fg={theme.textDim}> {portStr.padEnd(6)}</text>
                {project.status === 'running' ? (
                  <text fg={theme.success}>●</text>
                ) : (
                  <text fg={theme.textDim}> </text>
                )}
                <text fg={theme.textDim}> {memoryStr.padStart(5)}</text>
              </box>
              <Show when={domain}>
                <box paddingLeft={5}>
                  <text fg={theme.textDim}>{truncate(domain ?? '', 30)}</text>
                </box>
              </Show>
            </box>
          );
        }}
      </For>
    </box>
  );
}

// Activity section component
export function ActivitySection({ events }: { events: ActivityEvent[] }): JSX.Element {
  const displayEvents = events.slice(0, 10);

  return (
    <box flexDirection="column" marginTop={1}>
      <SectionHeader title="Activity" />
      <Show
        when={displayEvents.length > 0}
        fallback={
          <text fg={theme.textDim} paddingLeft={2}>
            No recent activity
          </text>
        }
      >
        <For each={displayEvents}>
          {(event) => {
            const icon = getActivityIcon(event.message);
            const color = getActivityColor(event.message);
            const time = formatTime(event.timestamp);
            const user = truncate(event.user, 8);

            return (
              <box paddingLeft={2}>
                <text fg={theme.textDim}>{time} </text>
                <text fg={theme.textMuted}>{user.padEnd(8)} </text>
                <text fg={color}>{icon} </text>
                <text fg={theme.textDim}>{truncate(event.message, 30)}</text>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}

// MCP Clients section component
export function McpClientsSection({ enabled }: { enabled: boolean }): JSX.Element {
  return (
    <box flexDirection="column" marginTop={1}>
      <SectionHeader title="MCP Clients" />
      <Show
        when={enabled}
        fallback={
          <box paddingLeft={2}>
            <text fg={theme.textDim}>MCP disabled</text>
          </box>
        }
      >
        <box flexDirection="column" paddingLeft={2}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>●</span> MCP server active (stdio)
          </text>
          <text fg={theme.textDim}>No clients connected yet</text>
          <text fg={theme.textDim}>
            Run: <span style={{ fg: theme.secondary }}>openlander mcp install --claude-code</span>
          </text>
        </box>
      </Show>
    </box>
  );
}

// Main DashboardPanel component
export function DashboardPanel(props: DashboardPanelProps): JSX.Element {
  const client = () => props.client;
  const height = () => props.height;
  const focus = () => props.focus;

  const [systemStats, setSystemStats] = createSignal<SystemStats | null>(null);
  const [health, setHealth] = createSignal<HealthResponse | null>(null);
  const [systemLoading, setSystemLoading] = createSignal(true);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [projectStats, setProjectStats] = createSignal<Map<string, ProjectStats>>(new Map());
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [activity, setActivity] = createSignal<ActivityEvent[]>([]);

  const [scrollOffset, _setScrollOffset] = createSignal(0);

  let lastDisplayKey = '';
  const onStatsUpdateRef = props.onStatsUpdate;

  createEffect(() => {
    if (!client()) return;
    const c = client();

    if (!c) return;

    let isFirstLoad = true;

    const fetchAll = async () => {
      const [statsResult, healthResult, projectsResult, activityResult] = await Promise.allSettled([
        c.getSystemStats(),
        c.ping(),
        c.listProjects(),
        c.getActivity(10),
      ]);

      let displayKey = '';
      let newStats: SystemStats | null = null;
      let newHealth: HealthResponse | null = null;
      let newProjects: Project[] = [];
      let newActivity: ActivityEvent[] = [];

      if (statsResult.status === 'fulfilled') {
        newStats = statsResult.value;
        const s = newStats;
        displayKey += `cpu:${String(Math.round(s.cpu.usagePercent))}|mem:${(s.memory.usedMB / 1024).toFixed(1)}/${(s.memory.totalMB / 1024).toFixed(1)}|disk:${String(Math.round(s.disk.usagePercent))}|up:${String(Math.floor(s.uptime.seconds / 60))}|`;
      }
      if (healthResult.status === 'fulfilled') {
        newHealth = healthResult.value;
        displayKey += `docker:${String(newHealth.dockerContainers)}|`;
      }
      if (projectsResult.status === 'fulfilled') {
        newProjects = projectsResult.value.projects;
        for (const p of newProjects) displayKey += `${p.name}:${p.status}:${String(p.port ?? '')}|`;
      }
      if (activityResult.status === 'fulfilled') {
        newActivity = activityResult.value;
        for (const e of newActivity) displayKey += `${e.timestamp}:${e.message}|`;
      }

      if (displayKey !== lastDisplayKey) {
        lastDisplayKey = displayKey;
        if (newStats) setSystemStats(newStats);
        if (newHealth) setHealth(newHealth);
        setProjects(newProjects);
        setActivity(newActivity);

        const statsMap = new Map<string, ProjectStats>();
        for (const project of newProjects) {
          if (project.status === 'running') {
            try {
              const ps = await c.getProjectStats(project.id);
              statsMap.set(project.id, ps);
            } catch {
              /* Project may not have a container */
            }
          }
        }
        setProjectStats(statsMap);

        const building = newProjects.filter((p) => p.status === 'building').length;
        onStatsUpdateRef?.({
          projectCount: newProjects.length,
          cpuPercent: newStats ? Math.round(newStats.cpu.usagePercent) : null,
          buildingCount: building,
        });
      }

      if (isFirstLoad) {
        setSystemLoading(false);
        isFirstLoad = false;
      }
    };

    void fetchAll();
    const timer = setInterval(() => {
      void fetchAll();
    }, 30000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (!focus()) return;
    if (evt.name === 'up') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : projects().length - 1));
    }
    if (evt.name === 'down') {
      setSelectedIndex((prev) => (prev < projects().length - 1 ? prev + 1 : 0));
    }
  });

  const estimatedLines = () =>
    2 + 2 + projects().length * 2 + 1 + Math.min(activity().length, 10) + 2;
  const showScrollUp = () => scrollOffset() > 0;
  const showScrollDown = () => estimatedLines() - scrollOffset() > height();

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
    >
      <Show when={showScrollUp()}>
        <text fg={theme.textDim}>↑ more</text>
      </Show>

      <SystemSection stats={systemStats()} health={health()} loading={systemLoading()} />
      <ProjectsSection
        projects={projects()}
        projectStats={projectStats()}
        selectedIndex={selectedIndex()}
        focus={focus()}
      />
      <ActivitySection events={activity()} />
      <McpClientsSection enabled={health() !== null} />

      <Show when={showScrollDown()}>
        <text fg={theme.textDim}>↓ more</text>
      </Show>

      <Show when={focus()}>
        <box marginTop={1}>
          <text fg={theme.textDim}>↑↓ Navigate projects</text>
        </box>
      </Show>
    </box>
  );
}
