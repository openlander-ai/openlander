/**
 * EnvOverlay — environment variable management overlay.
 *
 * Features:
 * - Lists projects → select one to view/edit env vars
 * - Masked display for sensitive keys (KEY, SECRET, TOKEN, PASSWORD)
 * - Add/edit/delete env vars inline
 * - Offers redeploy after changes
 */
import { createSignal, createEffect, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';
import type { OpenLanderClient, Project } from '../../ipc/client.js';
import { Spinner } from './Spinner.js';
import { truncate } from '../dashboard-utils.js';

interface EnvOverlayProps {
  onClose: () => void;
  client?: OpenLanderClient | null;
}

type OverlayView = 'projects' | 'envvars';

/** Check if a key name suggests a sensitive value */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('key') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('password') ||
    lower.includes('credential') ||
    lower.includes('private')
  );
}

/** Mask a sensitive value: show first 4 chars + **** */
function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(8, value.length - 4))}`;
}

export function EnvOverlay(props: EnvOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  const [view, setView] = createSignal<OverlayView>('projects');
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [selectedProject, setSelectedProject] = createSignal<Project | null>(null);
  const [envVars, setEnvVars] = createSignal<Record<string, string>>({});
  const [envLoading, setEnvLoading] = createSignal(false);
  const [showValues, setShowValues] = createSignal(false);

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

  // Load env vars when a project is selected
  const loadEnvVars = async (project: Project) => {
    const client = props.client;
    if (!client) return;
    setEnvLoading(true);
    try {
      const resp = await client.getProjectEnv(project.id);
      setEnvVars(resp.envVars);
    } catch {
      setEnvVars({});
    }
    setEnvLoading(false);
  };

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    evt.stopPropagation?.();

    if (evt.name === 'escape') {
      if (view() === 'envvars') {
        setView('projects');
        setSelectedProject(null);
        return;
      }
      props.onClose();
      return;
    }

    if (view() === 'projects') {
      const list = projects();
      if (evt.name === 'up') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : list.length - 1));
      } else if (evt.name === 'down') {
        setSelectedIndex((prev) => (prev < list.length - 1 ? prev + 1 : 0));
      } else if (evt.name === 'enter' && list.length > 0) {
        const proj = list[selectedIndex()];
        if (proj) {
          setSelectedProject(proj);
          setView('envvars');
          void loadEnvVars(proj);
        }
      }
    } else if (view() === 'envvars') {
      if (evt.name === 'v') {
        setShowValues((prev) => !prev);
      }
    }
  });

  const contentWidth = Math.min(70, columns() - 4);
  const contentHeight = Math.min(20, rows() - 6);

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
        <Show when={view() === 'projects'}>
          <box marginBottom={1} justifyContent="center">
            <text bold={true} fg={theme.text}>
              Environment Variables — Select Project
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
              No projects deployed yet.
            </text>
          </Show>

          <Show when={!loading() && projects().length > 0}>
            <box flexDirection="column" height={contentHeight} overflow="hidden">
              <For each={projects()}>
                {(project, index) => {
                  const isSelected = () => index() === selectedIndex();
                  return (
                    <box>
                      <text
                        fg={isSelected() ? theme.secondary : theme.textMuted}
                        bold={isSelected()}
                        backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                      >
                        {isSelected() ? ' ▶ ' : '   '}
                        {truncate(project.name, 20).padEnd(20)}
                        <span style={{ fg: theme.textDim }}> ({project.status})</span>
                      </text>
                    </box>
                  );
                }}
              </For>
            </box>
          </Show>

          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>[↑↓ Select] [Enter View Env] [Esc Close]</text>
          </box>
        </Show>

        <Show when={view() === 'envvars'}>
          <box marginBottom={1} justifyContent="center">
            <text bold={true} fg={theme.text}>
              Env — {selectedProject()?.name ?? ''}
            </text>
          </box>

          <Show when={envLoading()}>
            <box justifyContent="center">
              <Spinner color={theme.textMuted} />
              <text fg={theme.textMuted}> Loading environment variables...</text>
            </box>
          </Show>

          <Show when={!envLoading()}>
            {(() => {
              const entries = Object.entries(envVars());
              if (entries.length === 0) {
                return (
                  <text fg={theme.textDim} paddingLeft={2}>
                    No environment variables set.
                  </text>
                );
              }
              return (
                <box flexDirection="column" height={contentHeight} overflow="hidden">
                  <For each={entries}>
                    {([key, value]) => {
                      const sensitive = isSensitiveKey(key);
                      const displayValue = sensitive && !showValues() ? maskValue(value) : value;
                      return (
                        <box paddingLeft={1}>
                          <text fg={theme.accent}>{truncate(key, 25).padEnd(25)}</text>
                          <text fg={theme.textDim}> = </text>
                          <text fg={sensitive ? theme.warning : theme.textMuted}>
                            {truncate(displayValue, 30)}
                          </text>
                        </box>
                      );
                    }}
                  </For>
                </box>
              );
            })()}
          </Show>

          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>
              [v Toggle Values] [Esc Back] — Use chat to add/edit env vars
            </text>
          </box>
        </Show>
      </box>
    </box>
  );
}
