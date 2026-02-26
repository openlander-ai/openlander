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

interface TunnelOverlayProps {
  onClose: () => void;
  client?: OpenLanderClient | null;
}

export function TunnelOverlay(props: TunnelOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
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
    if (evt.name === 'up') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : list.length - 1));
    } else if (evt.name === 'down') {
      setSelectedIndex((prev) => (prev < list.length - 1 ? prev + 1 : 0));
    } else if (evt.name === 'enter' && list.length > 0 && !actionLoading()) {
      void toggleExposure();
    }
  });

  const contentWidth = Math.min(70, columns() - 4);
  const contentHeight = Math.min(16, rows() - 8);

  return (
    <box
      flexDirection="column"
      width={columns()}
      height={rows()}
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme.background}
    >
      <box
        flexDirection="column"
        border="round"
        borderColor={theme.borderActive}
        paddingX={2}
        paddingY={1}
        width={contentWidth}
        backgroundColor={theme.backgroundMenu}
      >
        <box marginBottom={1} justifyContent="center">
          <text bold={true} fg={theme.text}>
            Cloudflare Tunnel — Public Exposure
          </text>
        </box>

        <Show when={loading()}>
          <box justifyContent="center">
            <Spinner color={theme.textMuted} />
            <text fg={theme.textMuted}> Loading projects...</text>
          </box>
        </Show>

        <Show when={!loading() && projects().length === 0}>
          <text fg={theme.textDim} paddingLeft={2}>
            No projects deployed yet. Deploy a project first.
          </text>
        </Show>

        <Show when={!loading() && projects().length > 0}>
          <box flexDirection="column" height={contentHeight} overflow="hidden">
            <For each={projects()}>
              {(project, index) => {
                const isSelected = () => index() === selectedIndex();
                const isPublic = () => !!project.publicUrl;
                return (
                  <box>
                    <text
                      fg={isSelected() ? theme.secondary : theme.textMuted}
                      bold={isSelected()}
                      backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    >
                      {isSelected() ? ' ▶ ' : '   '}
                      {isPublic() ? '🌐' : '🔒'} {truncate(project.name, 16).padEnd(16)}
                      {project.status === 'running' ? (
                        <span style={{ fg: theme.success }}>● </span>
                      ) : (
                        <span style={{ fg: theme.textDim }}>○ </span>
                      )}
                      {isPublic() ? (
                        <span style={{ fg: theme.secondary }}>
                          {truncate(project.publicUrl ?? '', 30)}
                        </span>
                      ) : (
                        <span style={{ fg: theme.textDim }}>internal only</span>
                      )}
                    </text>
                  </box>
                );
              }}
            </For>
          </box>

          <Show when={actionLoading()}>
            <box justifyContent="center" marginTop={1}>
              <Spinner color={theme.warning} />
              <text fg={theme.warning}> Updating tunnel...</text>
            </box>
          </Show>
        </Show>

        <box marginTop={1} justifyContent="center">
          <text fg={theme.textDim}>[↑↓ Select] [Enter Toggle Public/Internal] [Esc Close]</text>
        </box>
      </box>
    </box>
  );
}
