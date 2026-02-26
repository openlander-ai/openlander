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
      <text bold={true} color={theme.sectionTitle}>{`▸ ${title}`}</text>
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
        <text dim={true}>
          <Spinner /> Loading...
        </text>
      </box>
    );
  }

  if (!stats) {
    return (
      <box flexDirection="column">
        <SectionHeader title="System" />
        <text dim={true}>Unavailable</text>
      </box>
    );
  }

  const cpuPercent = stats.cpu.usagePercent;
  const diskPercent = stats.disk.usagePercent;
  const dockerCount = health?.dockerContainers ?? 0;

  return (
    <box flexDirection="column">
      <SectionHeader title="System" />
      <box>
        <text>CPU </text>
        <text color={getColorForPercent(cpuPercent)}>
          {String(Math.round(cpuPercent)).padStart(2)}%{' '}
        </text>
        <text dim={true}>{miniBar(cpuPercent)}</text>
        <text dim={true}>
          {' '}
          MEM {formatMemory(stats.memory.usedMB)}/{formatMemory(stats.memory.totalMB)}GB
        </text>
      </box>
      <box>
        <text dim={true}>Disk {String(Math.round(diskPercent)).padStart(2)}%</text>
        <text dim={true}> Docker {dockerCount} containers</text>
        <text dim={true}> Uptime {formatUptime(stats.uptime.seconds)}</text>
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
        <text dim={true}>No projects yet</text>
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
              <box>
                {isSelected ? (
                  <text inverse={true} color={theme.secondary}>
                    {' '}
                  </text>
                ) : (
                  <text> </text>
                )}
                <text color={color}>{icon} </text>
                <text
                  color={isSelected ? theme.secondary : undefined}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {truncate(project.name, 12).padEnd(12)}
                </text>
                <text dim={true}> {portStr.padEnd(6)}</text>
                {project.status === 'running' ? (
                  <text color={theme.statusRunning}>✓</text>
                ) : (
                  <text dim={true}> </text>
                )}
                <text dim={true}> {memoryStr.padStart(5)}</text>
              </box>
              <Show when={domain}>
                <box>
                  <text> </text>
                  <text dim={true}>{truncate(domain!, 30)}</text>
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
      <Show when={displayEvents.length > 0} fallback={<text dim={true}>No recent activity</text>}>
        <For each={displayEvents}>
          {(event, index) => {
            const icon = getActivityIcon(event.message);
            const color = getActivityColor(event.message);
            const time = formatTime(event.timestamp);
            const user = truncate(event.user, 8);

            return (
              <box>
                <text dim={true}>{time} </text>
                <text>{user.padEnd(8)} </text>
                <text color={color}>{icon} </text>
                <text dim={true}>{truncate(event.message, 30)}</text>
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
            <text dim={true}>MCP disabled</text>
          </box>
        }
      >
        <box flexDirection="column" paddingLeft={2}>
          <text dim={true}>MCP server active (stdio)</text>
          <text dim={true}>No clients connected yet</text>
          <text dim={true}>
            Run: <span color={theme.secondary}>openlander mcp install --claude-code</span>
          </text>
        </box>
      </Show>
    </box>
  );
}

// Main DashboardPanel component
export function DashboardPanel({
  client,
  height,
  focus,
  onStatsUpdate,
}: DashboardPanelProps): JSX.Element {
  // State for all dashboard data
  const [systemStats, setSystemStats] = createSignal<SystemStats | null>(null);
  const [health, setHealth] = createSignal<HealthResponse | null>(null);
  const [systemLoading, setSystemLoading] = createSignal(true);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [projectStats, setProjectStats] = createSignal<Map<string, ProjectStats>>(new Map());
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [activity, setActivity] = createSignal<ActivityEvent[]>([]);

  // Scroll offset for when content exceeds height
  const [scrollOffset, _setScrollOffset] = createSignal(0);

  // Display-value dedup keys
  let lastDisplayKey = '';
  let onStatsUpdateRef = onStatsUpdate;

  // --- Single consolidated polling interval (30s) ---
  createEffect(() => {
    if (!client) return;

    let isFirstLoad = true;

    const fetchAll = async () => {
      const [statsResult, healthResult, projectsResult, activityResult] = await Promise.allSettled([
        client.getSystemStats(),
        client.ping(),
        client.listProjects(),
        client.getActivity(10),
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
        for (const p of newProjects) {
          displayKey += `${p.name}:${p.status}:${String(p.port ?? '')}|`;
        }
      }

      if (activityResult.status === 'fulfilled') {
        newActivity = activityResult.value;
        for (const e of newActivity) {
          displayKey += `${e.timestamp}:${e.message}|`;
        }
      }

      // Only update state if display would change
      if (displayKey !== lastDisplayKey) {
        lastDisplayKey = displayKey;
        if (newStats) setSystemStats(newStats);
        if (newHealth) setHealth(newHealth);
        setProjects(newProjects);
        setActivity(newActivity);

        // Fetch per-project stats for running projects
        const statsMap = new Map<string, ProjectStats>();
        for (const project of newProjects) {
          if (project.status === 'running') {
            try {
              const ps = await client.getProjectStats(project.id);
              statsMap.set(project.id, ps);
            } catch {
              // Project may not have a container
            }
          }
        }
        setProjectStats(statsMap);

        // Notify parent (for status bar)
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

    onCleanup(() => clearInterval(timer));
  });

  // Handle keyboard navigation when focused
  useKeyboard((evt) => {
    if (!focus) return;

    if (evt.key === 'up') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : projects().length - 1));
    }
    if (evt.key === 'down') {
      setSelectedIndex((prev) => (prev < projects().length - 1 ? prev + 1 : 0));
    }
  });

  // Estimate total content height for scrolling
  const estimatedLines = () =>
    2 + // System header + content
    2 + // Projects header
    projects().length * 2 + // Each project takes ~2 lines
    1 + // Activity header
    Math.min(activity().length, 10) + // Activity events
    2; // MCP section

  // Calculate scroll indicators
  const showScrollUp = () => scrollOffset() > 0;
  const showScrollDown = () => estimatedLines() - scrollOffset() > height;
  const linesAbove = () => scrollOffset();
  const linesBelow = () => Math.max(0, estimatedLines() - scrollOffset() - height);

  return (
    <box flexDirection="column" height={height} overflow="hidden">
      {/* Scroll indicator at top */}
      <Show when={showScrollUp()}>
        <text dim={true}>↑ {linesAbove()} more</text>
      </Show>

      {/* System Section */}
      <SystemSection stats={systemStats()} health={health()} loading={systemLoading()} />

      {/* Projects Section */}
      <ProjectsSection
        projects={projects()}
        projectStats={projectStats()}
        selectedIndex={selectedIndex()}
        focus={focus}
      />

      {/* Activity Section */}
      <ActivitySection events={activity()} />

      {/* MCP Clients Section */}
      <McpClientsSection enabled={health() !== null} />

      {/* Scroll indicator at bottom */}
      <Show when={showScrollDown()}>
        <text dim={true}>↓ {linesBelow()} more</text>
      </Show>

      {/* Focus indicator */}
      <Show when={focus}>
        <box marginTop={1}>
          <text dim={true}>↑↓ Navigate projects</text>
        </box>
      </Show>
    </box>
  );
}
