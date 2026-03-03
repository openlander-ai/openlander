import { createSignal, createEffect, onCleanup, Show, For, batch } from 'solid-js';
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
  ServerStatusResponse,
} from '../../ipc/client.js';
import type { Alert } from '../../monitor/alerts.js';
import { useAlerts } from '../hooks/useAlerts.js';
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
    memoryUsedMB: number | null;
  }) => void;
  onProjectSelect?: (projectId: string, projectName: string, port: number | null) => void;
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

// Server section component (v0.0.9)
export function ServerSection({
  serverStatus,
  loading,
}: {
  serverStatus: ServerStatusResponse | null;
  loading: boolean;
}): JSX.Element {
  if (loading && !serverStatus) {
    return (
      <box flexDirection="column">
        <SectionHeader title="Server" />
        <box paddingLeft={2} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>
            <Spinner color={theme.textMuted} />
          </text>
          <text fg={theme.textMuted}>Loading...</text>
        </box>
      </box>
    );
  }

  if (!serverStatus) {
    return <box />;
  }

  const { containers, portsInUse, proxy, externalContainers } = serverStatus;

  // Don't show section if no external containers
  if (externalContainers.length === 0) {
    return <box />;
  }

  // Truncate if more than 10
  const displayContainers =
    externalContainers.length > 10 ? [...externalContainers.slice(0, 5)] : externalContainers;
  const remainingCount = externalContainers.length > 10 ? externalContainers.length - 5 : 0;

  return (
    <box flexDirection="column">
      <SectionHeader title="Server" />
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>Containers: </text>
        <text fg={theme.text}>{String(containers.total)}</text>
        <text fg={theme.textDim}> (</text>
        <text fg={theme.success}>{String(containers.managed)} managed</text>
        <text fg={theme.textDim}>, </text>
        <text fg={theme.warning}>{String(containers.external)} external</text>
        <text fg={theme.textDim}>)</text>
      </box>
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>Ports in use: </text>
        <text fg={theme.text}>{String(portsInUse)}</text>
      </box>
      <box paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>Proxy: </text>
        <text fg={proxy.type === 'none' ? theme.textDim : theme.info}>
          {truncate(proxy.status, 40)}
        </text>
      </box>
      <For each={displayContainers}>
        {(container) => {
          const portStr = container.ports.length > 0 ? `:${String(container.ports[0])}` : '';
          return (
            <box paddingLeft={2} flexDirection="row" gap={1}>
              <text fg={theme.textDim}>●</text>
              <text fg={theme.textMuted}>{truncate(container.name, 14)}</text>
              <text fg={theme.textDim}>{portStr.padEnd(6)}</text>
            </box>
          );
        }}
      </For>
      <Show when={remainingCount > 0}>
        <box paddingLeft={2}>
          <text fg={theme.textDim}>{`...and ${String(remainingCount)} more`}</text>
        </box>
      </Show>
    </box>
  );
}

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
              <text fg={theme.statusBuilding}>
                <Spinner color={theme.statusBuilding} />
              </text>
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
      } else {
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

// Alerts section component
function AlertsSection(props: { alerts: Alert[] }): JSX.Element {
  const sorted = (): Alert[] => {
    const items = [...props.alerts];
    items.sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, warning: 1 };
      return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    });
    return items;
  };

  const visible = (): Alert[] => sorted().slice(0, 3);
  const remaining = (): number => Math.max(0, props.alerts.length - 3);

  return (
    <box flexDirection="column" marginTop={1}>
      <text bold={true} fg={theme.warning}>
        {'⚠ Alerts'}
      </text>
      <For each={visible()}>
        {(alert) => (
          <text fg={alert.severity === 'critical' ? theme.error : theme.warning}>
            {'  ⚠ '}
            {truncate(alert.message, 30)}
          </text>
        )}
      </For>
      <Show when={remaining() > 0}>
        <text fg={theme.textDim}>{'  +' + String(remaining()) + ' more'}</text>
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
  const [serverStatus, setServerStatus] = createSignal<ServerStatusResponse | null>(null);
  const [serverLoading, setServerLoading] = createSignal(true);

  const { alerts } = useAlerts(() => props.client);
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

  let lastSystemActivityKey = '';
  let lastProjectsKey = '';
  const onStatsUpdateRef = props.onStatsUpdate;

  createEffect(() => {
    if (!client()) {
      setSystemLoading(false);
      return;
    }
    const c = client();

    if (!c) return;

    let isFirstLoad = true;

    // ── Guards to prevent overlapping fetches ──────────────────────────────
    let fetchingProjects = false;
    let fetchingSystem = false;
    let fetchingServer = false;

    const fetchProjects = async () => {
      if (fetchingProjects) return; // Skip if previous fetch still running
      fetchingProjects = true;
      try {
        const [projectsResult] = await Promise.allSettled([c.listProjects()]);

        let projectsKey = '';
        let newProjects: Project[] = [];

        if (projectsResult.status === 'fulfilled') {
          newProjects = projectsResult.value.projects;
          for (const p of newProjects)
            projectsKey += `${p.name}:${p.status}:${String(p.port ?? '')}|`;
        }

        if (projectsKey !== lastProjectsKey) {
          lastProjectsKey = projectsKey;

          // Fetch stats for running projects IN PARALLEL (was sequential for-await)
          const runningProjects = newProjects.filter((p) => p.status === 'running');
          const statsEntries = await Promise.allSettled(
            runningProjects.map(async (project) => {
              const ps = await c.getProjectStats(project.id);
              return [project.id, ps] as const;
            }),
          );

          const statsMap = new Map<string, ProjectStats>();
          for (const entry of statsEntries) {
            if (entry.status === 'fulfilled') {
              statsMap.set(entry.value[0], entry.value[1]);
            }
          }

          // Batch all signal updates → single render pass
          batch(() => {
            setProjects(newProjects);
            setProjectStats(statsMap);

            const building = newProjects.filter((p) => p.status === 'building').length;
            const currentStats = systemStats();
            onStatsUpdateRef?.({
              projectCount: newProjects.length,
              cpuPercent: currentStats ? Math.round(currentStats.cpu.usagePercent) : null,
              buildingCount: building,
              memoryUsedMB: currentStats ? currentStats.memory.usedMB : null,
            });
          });
        }
      } finally {
        fetchingProjects = false;
      }
    };

    const fetchAll = async () => {
      if (fetchingSystem) return; // Skip if previous fetch still running
      fetchingSystem = true;
      try {
        const [statsResult, healthResult, activityResult] = await Promise.allSettled([
          c.getSystemStats(),
          c.ping(),
          c.getActivity(5),
        ]);

        let displayKey = '';
        let newStats: SystemStats | null = null;
        let newHealth: HealthResponse | null = null;
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
        if (activityResult.status === 'fulfilled') {
          newActivity = activityResult.value;
          for (const e of newActivity) displayKey += `${e.timestamp}:${e.message}|`;
        }

        if (displayKey !== lastSystemActivityKey) {
          lastSystemActivityKey = displayKey;
          // Batch all signal updates → single render pass
          batch(() => {
            if (newStats) setSystemStats(newStats);
            if (newHealth) setHealth(newHealth);
            setActivity(newActivity);

            const currentProjects = projects();
            const building = currentProjects.filter((p) => p.status === 'building').length;
            onStatsUpdateRef?.({
              projectCount: currentProjects.length,
              cpuPercent: newStats ? Math.round(newStats.cpu.usagePercent) : null,
              buildingCount: building,
              memoryUsedMB: newStats ? newStats.memory.usedMB : null,
            });
          });
        }

        if (isFirstLoad) {
          setSystemLoading(false);
          isFirstLoad = false;
        }
      } finally {
        fetchingSystem = false;
      }
    };

    void fetchAll().catch(() => {
      if (isFirstLoad) {
        setSystemLoading(false);
        isFirstLoad = false;
      }
    });
    void fetchProjects().catch(() => {
      /* ignore */
    });

    // Fetch server status (v0.0.9)
    const fetchServerStatus = async () => {
      if (fetchingServer) return; // Skip if previous fetch still running
      fetchingServer = true;
      try {
        const status = await c.getServerStatus();
        setServerStatus(status);
      } catch {
        /* ignore */
      } finally {
        setServerLoading(false);
        fetchingServer = false;
      }
    };

    void fetchServerStatus();

    // ── Relaxed polling intervals ──────────────────────────────────────────
    // Previous: 5s/3s/3s → caused render storm with overlapping fetches.
    // New: 10s unified cycle. Dashboard data doesn't need sub-second freshness.
    const systemActivityTimer = setInterval(() => {
      void fetchAll();
    }, 10_000);
    const projectsTimer = setInterval(() => {
      void fetchProjects();
    }, 10_000);
    const serverStatusTimer = setInterval(() => {
      void fetchServerStatus();
    }, 15_000);

    onCleanup(() => {
      clearInterval(systemActivityTimer);
      clearInterval(projectsTimer);
      clearInterval(serverStatusTimer);
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
    if (evt.name === 'return') {
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
        props.onProjectSelect(item.project.id, item.project.name, item.project.port ?? null);
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
      <ServerSection serverStatus={serverStatus()} loading={serverLoading()} />
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
        <Show when={alerts().length > 0}>
          <AlertsSection alerts={alerts()} />
        </Show>
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
