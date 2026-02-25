import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';
import type {
  OpenLanderClient,
  Project,
  ActivityEvent,
  HealthResponse,
  ProjectStats,
} from '../../ipc/client.js';
import type { SystemStats } from '../../monitor/stats.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

interface DashboardPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
}

// Status icons and colors for projects
const PROJECT_STATUS_ICON: Record<string, string> = {
  running: '●',
  building: '◐',
  stopped: '○',
  error: '✖',
};

const PROJECT_STATUS_COLOR: Record<string, string> = {
  running: theme.statusRunning,
  building: theme.statusBuilding,
  stopped: theme.statusStopped,
  error: theme.statusError,
};

// Activity type icons and colors
const ACTIVITY_ICON: Record<string, string> = {
  success: '✅',
  progress: '🔄',
  error: '❌',
  info: 'ℹ️',
};

const ACTIVITY_COLOR: Record<string, string> = {
  success: theme.success,
  progress: theme.progress,
  error: theme.error,
  info: theme.info,
};

// Helper: create a 3-char bar for percentage
function miniBar(percent: number): string {
  const filled = Math.round(percent / 33.33);
  const blocks = filled >= 3 ? '◼◼◼' : filled === 2 ? '◼◼◻' : filled === 1 ? '◼◻◻' : '◻◻◻';
  return blocks;
}

// Helper: get color based on percentage
function getColorForPercent(percent: number): string {
  if (percent > 80) return theme.resourceCrit;
  if (percent > 60) return theme.resourceWarn;
  return theme.resourceOk;
}

// Helper: format memory (MB to GB with 1 decimal)
function formatMemory(mb: number): string {
  const gb = mb / 1024;
  return gb.toFixed(1);
}

// Helper: format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

// Helper: truncate string with ellipsis
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// Helper: format timestamp to HH:MM
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

// Helper: get activity icon based on message content
function getActivityIcon(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('failed')) return ACTIVITY_ICON.error ?? 'ℹ️';
  if (lower.includes('started') || lower.includes('building') || lower.includes('progress'))
    return ACTIVITY_ICON.progress ?? 'ℹ️';
  if (
    lower.includes('success') ||
    lower.includes('deployed') ||
    lower.includes('updated') ||
    lower.includes('completed')
  )
    return ACTIVITY_ICON.success ?? 'ℹ️';
  return ACTIVITY_ICON.info ?? 'ℹ️';
}

// Helper: get activity color based on message content
function getActivityColor(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('failed')) return ACTIVITY_COLOR.error ?? 'cyan';
  if (lower.includes('started') || lower.includes('building') || lower.includes('progress'))
    return ACTIVITY_COLOR.progress ?? 'cyan';
  if (
    lower.includes('success') ||
    lower.includes('deployed') ||
    lower.includes('updated') ||
    lower.includes('completed')
  )
    return ACTIVITY_COLOR.success ?? 'cyan';
  return ACTIVITY_COLOR.info ?? 'cyan';
}

// Section header component
function SectionHeader({ title }: { title: string }): React.ReactElement {
  return (
    <Box>
      <Text bold color={theme.sectionTitle}>{`▸ ${title}`}</Text>
    </Box>
  );
}

// System section component
function SystemSection({
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
function ProjectsSection({
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
      <SectionHeader title={`Projects (${projects.length})`} />
      {projects.map((project, index) => {
        const isSelected = focus && index === selectedIndex;
        const icon = PROJECT_STATUS_ICON[project.status] ?? '?';
        const color = PROJECT_STATUS_COLOR[project.status] ?? 'white';
        const stats = projectStats.get(project.id);
        const memoryMB = stats?.memoryUsage ? Math.round(stats.memoryUsage / 1024 / 1024) : 0;
        const memoryStr = memoryMB > 0 ? `${memoryMB}M` : '';
        const portStr = project.port ? `:${project.port}` : '';
        const domain = project.publicUrl ?? project.url;

        return (
          <Box key={project.id} flexDirection="column">
            <Box>
              {isSelected && (
                <Text inverse color="cyan">
                  {' '}
                </Text>
              )}
              {!isSelected && <Text> </Text>}
              <Text color={color}>{icon} </Text>
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected} inverse={isSelected}>
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
function ActivitySection({ events }: { events: ActivityEvent[] }): React.ReactElement {
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
            <Box key={`${event.timestamp}-${index}`}>
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
function McpClientsSection({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionHeader title="MCP Clients" />
      {enabled ? (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor>MCP server active (stdio)</Text>
          <Text dimColor>No clients connected yet</Text>
          <Text dimColor>
            Run: <Text color="cyan">openlander mcp install --claude-code</Text>
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
export function DashboardPanel({ client, height, focus }: DashboardPanelProps): React.ReactElement {
  // State for system data
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);

  // State for projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectStats, setProjectStats] = useState<Map<string, ProjectStats>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);

  // State for activity
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  // Scroll offset for when content exceeds height
  const [scrollOffset, _setScrollOffset] = useState(0);

  // Poll system stats every 2 seconds
  useEffect(() => {
    if (!client) return;

    const fetchSystem = async () => {
      try {
        const [stats, healthResp] = await Promise.all([client.getSystemStats(), client.ping()]);
        setSystemStats(stats);
        setHealth(healthResp);
        setSystemLoading(false);
} catch (err) {
        log.debug({ err }, 'Failed to fetch system stats from daemon');
        setSystemLoading(false);
        setSystemLoading(false);
        setSystemLoading(false);
      }
    };

    void fetchSystem();
    const interval = setInterval(fetchSystem, 2000);
    return () => clearInterval(interval);
  }, [client]);

  // Poll projects every 3 seconds
  useEffect(() => {
    if (!client) return;

    const fetchProjects = async () => {
      try {
        const result = await client.listProjects();
        setProjects(result.projects);

        // Fetch stats for running projects
        const statsMap = new Map<string, ProjectStats>();
        for (const project of result.projects) {
          if (project.status === 'running') {
            try {
              const stats = await client.getProjectStats(project.id);
              statsMap.set(project.id, stats);
            } catch (err) {
              log.debug({ err, projectId: project.id }, 'Failed to get project stats');
              // Project may not have a container
            }
          }
        }
        setProjectStats(statsMap);
      } catch (err) {
        log.debug({ err }, 'Failed to list projects');
        // Ignore errors
      }
    };

    void fetchProjects();
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, [client]);

  // Poll activity every 5 seconds
  useEffect(() => {
    if (!client) return;

    const fetchActivity = async () => {
      try {
        const events = await client.getActivity(10);
        setActivity(events);
      } catch (err) {
        log.debug({ err }, 'Failed to get activity from daemon');
        // Ignore errors
      }
    };

    void fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, [client]);

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
