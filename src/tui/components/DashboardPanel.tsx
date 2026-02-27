import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { overlayActive } from '../state/overlay.js';
import { Spinner } from './Spinner.js';
import { theme } from '../theme.js';
import { ProgressBar } from './ProgressBar.js';
import {
  PROJECT_STATUS_ICON,
  PROJECT_STATUS_COLOR,
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
  compact?: boolean;
  onStatsUpdate?: (data: {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
  }) => void;
  onProjectSelect?: (projectId: string, projectName: string) => void;
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
  const memPercent = stats.memory.usagePercent;
  const diskPercent = stats.disk.usagePercent;
  const dockerCount = health?.dockerContainers ?? 0;

  return (
    <box flexDirection="column">
      <SectionHeader title="System" />
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>CPU </text>
        <text fg={getColorForPercent(cpuPercent)}>
          {String(Math.round(cpuPercent)).padStart(3)}%
        </text>
        <ProgressBar percent={cpuPercent} width={12} color={getColorForPercent(cpuPercent)} />
      </box>
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>MEM </text>
        <text fg={getColorForPercent(memPercent)}>
          {formatMemory(stats.memory.usedMB)}/{formatMemory(stats.memory.totalMB)}GB
        </text>
        <ProgressBar percent={memPercent} width={12} color={getColorForPercent(memPercent)} />
      </box>
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>DSK </text>
        <text fg={getColorForPercent(diskPercent)}>
          {String(Math.round(diskPercent)).padStart(3)}%
        </text>
        <ProgressBar percent={diskPercent} width={12} color={getColorForPercent(diskPercent)} />
      </box>
      <box paddingLeft={2}>
        <text fg={theme.textDim}>
          Docker {dockerCount} containers │ Uptime {formatUptime(stats.uptime.seconds)}
        </text>
      </box>
    </box>
  );
}

// Internal service names that don't have external URLs
const INTERNAL_SERVICES = new Set([
  'db',
  'redis',
  'postgres',
  'mongo',
  'cache',
  'rabbitmq',
  'kafka',
  'zookeeper',
  'memcached',
  'elasticsearch',
]);

function isInternalService(name: string, port: number | null): boolean {
  return INTERNAL_SERVICES.has(name.toLowerCase()) || port === null;
}

// Type for visible item in navigation
interface VisibleItem {
  type: 'header' | 'project';
  project: Project;
  childOf?: string; // Parent compose group ID if this is a child
}

// Projects section component
export function ProjectsSection({
  projects,
  projectStats,
  selectedIndex,
  focus,
  collapsedGroups,
  visibleItems: _visibleItems,
}: {
  projects: Project[];
  projectStats: Map<string, ProjectStats>;
  selectedIndex: number;
  focus: boolean;
  collapsedGroups: Set<string>;
  visibleItems: VisibleItem[];
}): JSX.Element {
  // Filter to only top-level projects
  const topLevelProjects = projects.filter((p) => p.parentProjectId === null);

  if (topLevelProjects.length === 0) {
    return (
      <box flexDirection="column" marginTop={1}>
        <SectionHeader title="Projects (0)" />
        <text fg={theme.textDim} paddingLeft={2}>
          No projects yet
        </text>
      </box>
    );
  }

  let visibleIndex = 0;

  const renderProjectRow = (
    project: Project,
    isSelected: boolean,
    indent = 0,
    isChild = false,
  ): JSX.Element => {
    const icon = PROJECT_STATUS_ICON[project.status] ?? '?';
    const color = PROJECT_STATUS_COLOR[project.status] ?? 'white';
    const stats = projectStats.get(project.id);
    const memoryMB = stats?.memoryUsage ? Math.round(stats.memoryUsage / 1024 / 1024) : 0;
    const memoryStr = memoryMB > 0 ? `${String(memoryMB)}M` : '';
    const internal = isChild && isInternalService(project.name, project.port);
    const portStr = internal ? '—' : project.port ? `:${String(project.port)}` : '';
    const domain = internal ? null : (project.publicUrl ?? project.url);

    return (
      <box flexDirection="column">
        <box paddingLeft={1 + indent}>
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
          ) : project.status === 'building' ? (
            <box flexDirection="row" gap={1}>
              <Spinner color={theme.statusBuilding} />
              <text fg={theme.statusBuilding}>Building…</text>
            </box>
          ) : (
            <text fg={theme.textDim}> </text>
          )}
          <Show when={project.status !== 'building'}>
            <text fg={theme.textDim}> {memoryStr.padStart(5)}</text>
          </Show>
        </box>
        <Show when={domain}>
          <box paddingLeft={5 + indent}>
            <text fg={theme.textDim}>{truncate(domain ?? '', 30)}</text>
          </box>
        </Show>
      </box>
    );
  };

  const renderComposeGroup = (project: Project): JSX.Element[] => {
    const isCollapsed = collapsedGroups.has(project.id);
    const expandIcon = isCollapsed ? '▶' : '▼';
    const childProjects = projects.filter((p) => p.parentProjectId === project.id);
    const currentVisibleIndex = visibleIndex++;
    const isSelected = focus && currentVisibleIndex === selectedIndex;

    const rows: JSX.Element[] = [];

    // Header row
    rows.push(
      <box flexDirection="column">
        <box paddingLeft={1}>
          {isSelected ? (
            <text backgroundColor={theme.backgroundElement} fg={theme.secondary} bold={true}>
              {' ▶ '}
            </text>
          ) : (
            <text fg={theme.textDim}>{'   '}</text>
          )}
          <text fg={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
            {expandIcon} {truncate(project.name, 10)} (compose, {String(project.serviceCount)}{' '}
            services)
          </text>
        </box>
      </box>,
    );

    // Child rows (only if expanded)
    if (!isCollapsed) {
      for (const child of childProjects) {
        const childIndex = visibleIndex++;
        const childSelected = focus && childIndex === selectedIndex;
        rows.push(renderProjectRow(child, childSelected, 2, true));
      }
    }

    return rows;
  };

  const renderContent = (): JSX.Element[] => {
    const elements: JSX.Element[] = [];
    visibleIndex = 0;

    for (const project of topLevelProjects) {
      if (project.isCompose) {
        for (const row of renderComposeGroup(project)) {
          elements.push(row);
        }
        const currentIndex = visibleIndex++;
        const isSelected = focus && currentIndex === selectedIndex;
        elements.push(renderProjectRow(project, isSelected));
      }
    }

    return elements;
  };

  return (
    <box flexDirection="column" marginTop={1}>
      <SectionHeader title={`Projects (${String(topLevelProjects.length)})`} />
      {renderContent()}
    </box>
  );
}

// Activity section component
export function ActivitySection({ events }: { events: ActivityEvent[] }): JSX.Element {
  const displayEvents = events.slice(0, 5);

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
  const compact = () => props.compact ?? false;

  const [systemStats, setSystemStats] = createSignal<SystemStats | null>(null);
  const [health, setHealth] = createSignal<HealthResponse | null>(null);
  const [systemLoading, setSystemLoading] = createSignal(true);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [projectStats, setProjectStats] = createSignal<Map<string, ProjectStats>>(new Map());
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [activity, setActivity] = createSignal<ActivityEvent[]>([]);

  const [scrollOffset, _setScrollOffset] = createSignal(0);
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());

  // Build visible items for keyboard navigation
  const buildVisibleItems = (): VisibleItem[] => {
    const items: VisibleItem[] = [];
    const collapsed = collapsedGroups();
    const allProjects = projects();
    const topLevelProjects = allProjects.filter((p) => p.parentProjectId === null);

    for (const project of topLevelProjects) {
      if (project.isCompose) {
        // Add compose header
        items.push({ type: 'header', project });
        // Add children if expanded
        if (!collapsed.has(project.id)) {
          const children = allProjects.filter((p) => p.parentProjectId === project.id);
          for (const child of children) {
            items.push({ type: 'project', project: child, childOf: project.id });
          }
        }
      } else {
        items.push({ type: 'project', project });
      }
    }

    return items;
  };

  const visibleItems = () => buildVisibleItems();

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
        c.getActivity(5),
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
    }, 5000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (overlayActive() || !focus()) return;
    const items = visibleItems();
    const itemCount = items.length;
    if (evt.name === 'up' || evt.name === 'k') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
    }
    if (evt.name === 'down' || evt.name === 'j') {
      setSelectedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
    }
    if (evt.name === 'enter') {
      const item = items[selectedIndex()];
      if (!item) return;
      if (item.type === 'header') {
        // Toggle collapse/expand for compose group
        setCollapsedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(item.project.id)) {
            next.delete(item.project.id);
          } else {
            next.add(item.project.id);
          }
          return next;
        });
      } else if (props.onProjectSelect) {
        // Select the project
        props.onProjectSelect(item.project.id, item.project.name);
      }
    }
  });

  const estimatedLines = () =>
    2 + 2 + projects().length * 2 + 1 + Math.min(activity().length, 5) + 2;
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
        collapsedGroups={collapsedGroups()}
        visibleItems={visibleItems()}
      />
      <Show when={!compact()}>
        <ActivitySection events={activity()} />
        <McpClientsSection enabled={health() !== null} />
      </Show>

      <Show when={showScrollDown()}>
        <text fg={theme.textDim}>↓ more</text>
      </Show>

      <Show when={focus() && !compact()}>
        <box marginTop={1}>
          <text fg={theme.textDim}>↑↓ Navigate Enter Debug mode</text>
        </box>
      </Show>
    </box>
  );
}
