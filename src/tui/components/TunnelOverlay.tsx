/**
 * TunnelOverlay — Cloudflare Tunnel configuration overlay.
 *
 * Shows projects with their public/internal status and allows
 * toggling public exposure via TryCloudflare quick tunnels.
 */
import { createSignal, createEffect, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';
import type { OpenLanderClient, Project } from '../../ipc/client.js';
import { Spinner } from './Spinner.js';
import { truncate } from '../dashboard-utils.js';
import { OverlayContainer } from './OverlayContainer.js';

interface TunnelOverlayProps {
  onClose: () => void;
  client?: OpenLanderClient | null;
}

export function TunnelOverlay(props: TunnelOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const rows = () => dims().height;

  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [actionLoading, setActionLoading] = createSignal(false);

  // Load projects
  createEffect(() => {
    const client = props.client;
    if (!client) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const resp = await client.listProjects();
        setProjects(resp.projects);
      } catch {
        // Ignore
      }
      setLoading(false);
    })();
  });

  const refreshProjects = async () => {
    const client = props.client;
    if (!client) return;
    try {
      const resp = await client.listProjects();
      setProjects(resp.projects);
    } catch {
      // Ignore
    }
  };

  const toggleExposure = async () => {
    const client = props.client;
    const list = projects();
    const proj = list[selectedIndex()];
    if (!client || !proj || proj.status !== 'running') return;

    setActionLoading(true);
    try {
      if (proj.publicUrl) {
        await client.unexposeProject(proj.id);
      } else {
        await client.exposeProject(proj.id);
      }
      await refreshProjects();
    } catch {
      // Ignore errors
    }
    setActionLoading(false);
  };

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    evt.stopPropagation?.();

    if (evt.name === 'escape') {
      props.onClose();
      return;
    }

    const list = projects();
    if (evt.name === 'up' || evt.name === 'k') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : list.length - 1));
    } else if (evt.name === 'down' || evt.name === 'j') {
      setSelectedIndex((prev) => (prev < list.length - 1 ? prev + 1 : 0));
    } else if (evt.name === 'return' && list.length > 0 && !actionLoading()) {
      void toggleExposure();
    }
  });

  const contentHeight = () => Math.min(16, rows() - 8);

  return (
    <OverlayContainer
      title="Cloudflare Tunnel — Public Exposure"
      width={70}
      responsive={true}
      footer="[↑↓ Navigate] [Enter Toggle] [Esc Close]"
    >
      <Show when={loading()}>
        <box justifyContent="center">
          <text fg={theme.textMuted}>
            <Spinner color={theme.textMuted} />
          </text>
          <text fg={theme.textMuted}> Loading projects...</text>
        </box>
      </Show>

      <Show when={!loading() && projects().length === 0}>
        <text fg={theme.textDim} paddingLeft={2}>
          No projects deployed yet. Deploy a project first.
        </text>
      </Show>

      <Show when={!loading() && projects().length > 0}>
        <box flexDirection="column" height={contentHeight()} overflow="hidden">
          <For each={projects()}>
            {(project, index) => {
              const isSelected = () => index() === selectedIndex();
              const isPublic = () => !!project.publicUrl;
              return (
                <box flexDirection="row">
                  <text
                    fg={isSelected() ? theme.secondary : theme.textMuted}
                    bold={isSelected()}
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                  >
                    {isSelected() ? ' ▶ ' : '   '}
                    {isPublic() ? '●' : '○'} {truncate(project.name, 16).padEnd(16)}
                  </text>
                  <text
                    fg={project.status === 'running' ? theme.success : theme.textDim}
                    bold={isSelected()}
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                  >
                    {' '}
                    {project.status === 'running' ? '●' : '○'}
                  </text>
                  <text
                    fg={isPublic() ? theme.secondary : theme.textDim}
                    bold={isSelected()}
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                  >
                    {' '}
                    {isPublic() ? truncate(project.publicUrl ?? '', 30) : 'internal only'}
                  </text>
                </box>
              );
            }}
          </For>
        </box>

        <Show when={actionLoading()}>
          <box justifyContent="center" marginTop={1}>
            <text fg={theme.warning}>
              <Spinner color={theme.warning} />
            </text>
            <text fg={theme.warning}> Updating tunnel...</text>
          </box>
        </Show>
      </Show>
    </OverlayContainer>
  );
}
