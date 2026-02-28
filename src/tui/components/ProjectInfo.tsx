/**
 * ProjectInfo — shown in debug mode (top section).
 *
 * Displays project metadata: status, port, domain, repo, uptime, CPU, MEM.
 * Polls project stats every 3 seconds while visible.
 */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import type { JSX, Accessor } from 'solid-js';
import { theme } from '../theme.js';
import {
  PROJECT_STATUS_ICON,
  PROJECT_STATUS_COLOR,
  getColorForPercent,
  truncate,
} from '../dashboard-utils.js';
import type { OpenLanderClient, Project, ProjectStats } from '../../ipc/client.js';
import { Spinner } from './Spinner.js';
import { formatImageId, formatRelativeTime, formatUptime } from './project-info-utils.js';

interface ProjectInfoProps {
  projectId: string;
  projectName: string;
  client: OpenLanderClient | null;
  height: number;
}

export function ProjectInfo(props: ProjectInfoProps): JSX.Element {
  const [project, setProject] = createSignal<Project | null>(null);
  const [stats, setStats] = createSignal<ProjectStats | null>(null);
  const [loading, setLoading] = createSignal(true);

  // Poll project info and stats
  createEffect(() => {
    const client = props.client;
    const projectId = props.projectId;
    if (!client || !projectId) return;

    let isFirstLoad = true;

    const fetchData = async () => {
      try {
        const projectsResp = await client.listProjects();
        const found = projectsResp.projects.find((p) => p.id === projectId);
        if (found) {
          setProject(found);
          if (found.status === 'running') {
            try {
              const projectStats = await client.getProjectStats(projectId);
              setStats(projectStats);
            } catch {
              // Container may not have stats yet
            }
          }
        }
      } catch {
        // Daemon may be unreachable
      }
      if (isFirstLoad) {
        setLoading(false);
        isFirstLoad = false;
      }
    };

    void fetchData();
    const timer = setInterval(() => {
      void fetchData();
    }, 3000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  const statusIcon = () => {
    const p = project();
    if (!p) return '?';
    return PROJECT_STATUS_ICON[p.status] ?? '?';
  };

  const statusColor = () => {
    const p = project();
    if (!p) return theme.textDim;
    return PROJECT_STATUS_COLOR[p.status] ?? theme.textDim;
  };

  const memoryStr = () => {
    const s = stats();
    if (!s) return '—';
    const mb = Math.round(s.memoryUsage / 1024 / 1024);
    const limitMb = Math.round(s.memoryLimit / 1024 / 1024);
    return limitMb > 0 ? `${String(mb)}MB / ${String(limitMb)}MB` : `${String(mb)}MB`;
  };

  const cpuStr = () => {
    const s = stats();
    if (!s) return '—';
    return `${s.cpu.toFixed(1)}%`;
  };

  const cpuPercent = () => stats()?.cpu ?? 0;
  const memPercent = () => stats()?.memoryPercent ?? 0;
  const imageDisplay = () => formatImageId(stats()?.containerId);
  const uptimeDisplay = () =>
    project()?.status === 'running' ? formatUptime(project()?.createdAt ?? '') : '—';
  const lastDeployDisplay = () => formatRelativeTime(project()?.updatedAt ?? '');

  return (
    <box flexDirection="column" height={props.height} paddingLeft={2} paddingTop={1}>
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text bold={true} fg={theme.text}>
          ▸ {props.projectName || 'Project'}
        </text>
        <Show when={loading()}>
          <text fg={theme.textMuted}>
            <Spinner color={theme.textMuted} />
          </text>
        </Show>
      </box>

      <Show
        when={project()}
        fallback={
          <text fg={theme.textDim} paddingLeft={2}>
            {loading() ? 'Loading project info...' : 'Project not found'}
          </text>
        }
      >
        {(p: Accessor<Project>) => (
          <box flexDirection="column" paddingLeft={2} paddingTop={0}>
            {/* Status row */}
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Status</text>
              <text fg={statusColor()}>
                {statusIcon()} {p().status}
              </text>
            </box>

            {/* Port */}
            <Show when={p().port}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>Port </text>
                <text fg={theme.text}>:{String(p().port)}</text>
              </box>
            </Show>

            {/* Domain/URL */}
            <Show when={p().publicUrl ?? p().url}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>URL </text>
                <text fg={theme.secondary}>{truncate(p().publicUrl ?? p().url ?? '', 40)}</text>
              </box>
            </Show>

            {/* Repo */}
            <Show when={p().repoUrl}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>Repo </text>
                <text fg={theme.textDim}>{truncate(p().repoUrl ?? '', 40)}</text>
              </box>
            </Show>

            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Image </text>
              <text fg={theme.text}>{imageDisplay()}</text>
            </box>

            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Uptime </text>
              <text fg={theme.text}>{uptimeDisplay()}</text>
            </box>

            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Last deploy </text>
              <text fg={theme.text}>{lastDeployDisplay()}</text>
            </box>

            {/* CPU & Memory (only when running) */}
            <Show when={stats()}>
              <box flexDirection="row" gap={2}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>CPU</text>
                  <text fg={getColorForPercent(cpuPercent())}>{cpuStr()}</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>MEM</text>
                  <text fg={getColorForPercent(memPercent())}>{memoryStr()}</text>
                </box>
              </box>
            </Show>
          </box>
        )}
      </Show>
    </box>
  );
}
