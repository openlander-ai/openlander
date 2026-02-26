import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
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
export function SectionHeader({ title }: { title: string }): React.ReactElement {
  return (
    <Box>
      <Text bold color={theme.sectionTitle}>{`▸ ${title}`}</Text>
    </Box>
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
}): React.ReactElement {
  if (loading && !stats) {
    return (
      <Box flexDirection="column">
        <SectionHeader title="System" />
        <Text dimColor>
          <Spinner type="dots" /> Loading...
        </Text>
      </Box>
    );
  }

  if (!stats) {
    return (
      <Box flexDirection="column">
        <SectionHeader title="System" />
        <Text dimColor>Unavailable</Text>
      </Box>
    );
  }

  const cpuPercent = stats.cpu.usagePercent;
  const diskPercent = stats.disk.usagePercent;
  const dockerCount = health?.dockerContainers ?? 0;

  return (
    <Box flexDirection="column">
      <SectionHeader title="System" />
      <Box>
        <Text>CPU </Text>
        <Text color={getColorForPercent(cpuPercent)}>
          {String(Math.round(cpuPercent)).padStart(2)}%{' '}
        </Text>
        <Text dimColor>{miniBar(cpuPercent)}</Text>
        <Text dimColor>
          {' '}
          MEM {formatMemory(stats.memory.usedMB)}/{formatMemory(stats.memory.totalMB)}GB
        </Text>
      </Box>
      <Box>
        <Text dimColor>Disk {String(Math.round(diskPercent)).padStart(2)}%</Text>
        <Text dimColor> Docker {dockerCount} containers</Text>
        <Text dimColor> Uptime {formatUptime(stats.uptime.seconds)}</Text>
      </Box>
    </Box>
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
}): React.ReactElement {
  if (projects.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader title="Projects (0)" />
        <Text dimColor>No projects yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionHeader title={`Projects (${String(projects.length)})`} />
      {projects.map((project, index) => {
        const isSelected = focus && index === selectedIndex;
        const icon = PROJECT_STATUS_ICON[project.status] ?? '?';
        const color = PROJECT_STATUS_COLOR[project.status] ?? 'white';
        const stats = projectStats.get(project.id);
        const memoryMB = stats?.memoryUsage ? Math.round(stats.memoryUsage / 1024 / 1024) : 0;
        const memoryStr = memoryMB > 0 ? `${String(memoryMB)}M` : '';
        const portStr = project.port ? `:${String(project.port)}` : '';
        const domain = project.publicUrl ?? project.url;

        return (
          <Box key={project.id} flexDirection="column">
            <Box>
              {isSelected && (
                <Text inverse color={theme.secondary}>
                  {' '}
                </Text>
              )}
              {!isSelected && <Text> </Text>}
              <Text color={color}>{icon} </Text>
              <Text
                color={isSelected ? theme.secondary : undefined}
                bold={isSelected}
                inverse={isSelected}
              >
                {truncate(project.name, 12).padEnd(12)}
              </Text>
              <Text dimColor> {portStr.padEnd(6)}</Text>
              {project.status === 'running' ? (
                <Text color={theme.statusRunning}>✓</Text>
              ) : (
                <Text dimColor> </Text>
              )}
              <Text dimColor> {memoryStr.padStart(5)}</Text>
            </Box>
            {domain && (
              <Box>
                <Text> </Text>
                <Text dimColor>{truncate(domain, 30)}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// Activity section component
export function ActivitySection({ events }: { events: ActivityEvent[] }): React.ReactElement {
  const displayEvents = events.slice(0, 10);

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionHeader title="Activity" />
      {displayEvents.length === 0 ? (
        <Text dimColor>No recent activity</Text>
      ) : (
        displayEvents.map((event, index) => {
          const icon = getActivityIcon(event.message);
          const color = getActivityColor(event.message);
          const time = formatTime(event.timestamp);
          const user = truncate(event.user, 8);

          return (
            <Box key={`${event.timestamp}-${String(index)}`}>
              <Text dimColor>{time} </Text>
              <Text>{user.padEnd(8)} </Text>
              <Text color={color}>{icon} </Text>
              <Text dimColor>{truncate(event.message, 30)}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

// MCP Clients section component
export function McpClientsSection({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionHeader title="MCP Clients" />
      {enabled ? (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor>MCP server active (stdio)</Text>
          <Text dimColor>No clients connected yet</Text>
          <Text dimColor>
            Run: <Text color={theme.secondary}>openlander mcp install --claude-code</Text>
          </Text>
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text dimColor>MCP disabled</Text>
        </Box>
      )}
    </Box>
  );
}

// Main DashboardPanel component
export function DashboardPanel({
  client,
  height,
  focus,
  onStatsUpdate,
}: DashboardPanelProps): React.ReactElement {
  // State for all dashboard data
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectStats, setProjectStats] = useState<Map<string, ProjectStats>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  // Scroll offset for when content exceeds height
  const [scrollOffset, _setScrollOffset] = useState(0);

  // Display-value dedup keys (only re-render when what user SEES changes)
  const lastDisplayKeyRef = useRef('');
  const onStatsUpdateRef = useRef(onStatsUpdate);
  onStatsUpdateRef.current = onStatsUpdate;

  // --- Single consolidated polling interval (30s) ---
  useEffect(() => {
    if (!client) return;

    const fetchAll = async () => {
      // Fetch all data in parallel
      const [statsResult, healthResult, projectsResult, activityResult] = await Promise.allSettled([
        client.getSystemStats(),
        client.ping(),
        client.listProjects(),
        client.getActivity(10),
      ]);

      // Build a display-key from only the VALUES that appear on screen
      // CPU rounded to integer, memory to 0.1GB, uptime to minutes, disk to integer
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
        // Project display: name+status+port for each
        for (const p of newProjects) {
          displayKey += `${p.name}:${p.status}:${String(p.port ?? '')}|`;
        }
      }

      if (activityResult.status === 'fulfilled') {
        newActivity = activityResult.value;
        // Activity display: timestamp+message for each
        for (const e of newActivity) {
          displayKey += `${e.timestamp}:${e.message}|`;
        }
      }

      // Only update state if display would change
      if (displayKey !== lastDisplayKeyRef.current) {
        lastDisplayKeyRef.current = displayKey;
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
        onStatsUpdateRef.current?.({
          projectCount: newProjects.length,
          cpuPercent: newStats ? Math.round(newStats.cpu.usagePercent) : null,
          buildingCount: building,
        });
      }

      if (systemLoading) setSystemLoading(false);
    };

    void fetchAll();
    const timer = setInterval(() => {
      void fetchAll();
    }, 30000);
    return () => {
      clearInterval(timer);
    };
  }, [client, systemLoading]);

  // Handle keyboard navigation when focused
  useInput(
    useCallback(
      (_input, key) => {
        if (!focus) return;

        if (key.upArrow) {
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : projects.length - 1));
        }
        if (key.downArrow) {
          setSelectedIndex((prev) => (prev < projects.length - 1 ? prev + 1 : 0));
        }
      },
      [focus, projects.length],
    ),
    { isActive: focus },
  );

  // Estimate total content height for scrolling
  // System: ~2 lines, Projects: ~2 + (projects * 2), Activity: ~1 + events, MCP: ~2
  const estimatedLines =
    2 + // System header + content
    2 + // Projects header
    projects.length * 2 + // Each project takes ~2 lines
    1 + // Activity header
    Math.min(activity.length, 10) + // Activity events
    2; // MCP section

  // Calculate scroll indicators
  const showScrollUp = scrollOffset > 0;
  const showScrollDown = estimatedLines - scrollOffset > height;
  const linesAbove = scrollOffset;
  const linesBelow = Math.max(0, estimatedLines - scrollOffset - height);

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {/* Scroll indicator at top */}
      {showScrollUp && <Text dimColor>↑ {linesAbove} more</Text>}

      {/* System Section */}
      <SystemSection stats={systemStats} health={health} loading={systemLoading} />

      {/* Projects Section */}
      <ProjectsSection
        projects={projects}
        projectStats={projectStats}
        selectedIndex={selectedIndex}
        focus={focus}
      />

      {/* Activity Section */}
      <ActivitySection events={activity} />

      {/* MCP Clients Section */}
      <McpClientsSection enabled={health !== null} />

      {/* Scroll indicator at bottom */}
      {showScrollDown && <Text dimColor>↓ {linesBelow} more</Text>}

      {/* Focus indicator */}
      {focus && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ Navigate projects</Text>
        </Box>
      )}
    </Box>
  );
}
