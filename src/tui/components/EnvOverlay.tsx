import { createSignal, createEffect, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';
import type { OpenLanderClient, Project } from '../../ipc/client.js';
import { Spinner } from './Spinner.js';
import { truncate } from '../dashboard-utils.js';
import { OverlayContainer } from './OverlayContainer.js';

interface EnvOverlayProps {
  onClose: () => void;
  client?: OpenLanderClient | null;
}

type OverlayView = 'projects' | 'envvars';
type EnvEditorState = 'viewing' | 'adding' | 'editing';

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
  const [selectedEnvIndex, setSelectedEnvIndex] = createSignal(0);
  const [editorState, setEditorState] = createSignal<EnvEditorState>('viewing');
  const [editorInput, setEditorInput] = createSignal('');
  const [editingKey, setEditingKey] = createSignal<string | null>(null);
  const [statusMessage, setStatusMessage] = createSignal<string>('');
  const [statusIsError, setStatusIsError] = createSignal(false);

  let editorTextareaRef: { plainText: string; setText?: (text: string) => void } | undefined;
  let pendingSubmitText: string | null = null;

  const envEntries = () => Object.entries(envVars());
  const contentWidth = () => Math.min(70, columns() - 4);
  const contentHeight = () => Math.min(20, rows() - 6);

  const overlayTitle = () =>
    view() === 'projects'
      ? 'Environment Variables — Select Project'
      : `Env — ${selectedProject()?.name ?? ''}`;

  const footerText = () => {
    if (view() === 'projects') return '[↑↓ Select] [Enter View Env] [Esc Close]';
    return editorState() === 'viewing'
      ? '[↑↓ Navigate] [a Add] [e Edit] [d Delete] [v Toggle Values] [Esc Back]'
      : '[Enter Save] [Esc Cancel]';
  };

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

  const saveEnvVars = async (nextVars: Record<string, string>) => {
    const client = props.client;
    const project = selectedProject();
    if (!client || !project) return;
    setEnvLoading(true);
    setStatusMessage('');
    try {
      await client.setProjectEnv(project.id, nextVars);
      await loadEnvVars(project);
      setStatusIsError(false);
      setStatusMessage('Environment variables updated.');
    } catch (err) {
      setEnvLoading(false);
      setStatusIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to update environment variables.',
      );
    }
  };

  const beginAdd = () => {
    setEditorState('adding');
    setEditingKey(null);
    setEditorInput('');
    setStatusMessage('');
    pendingSubmitText = null;
    if (editorTextareaRef?.setText) {
      editorTextareaRef.setText('');
    }
  };

  const beginEdit = () => {
    const entries = envEntries();
    const selected = entries[selectedEnvIndex()];
    if (!selected) return;
    const [key, value] = selected;
    setEditingKey(key);
    setEditorState('editing');
    setEditorInput(value);
    setStatusMessage('');
    pendingSubmitText = null;
    if (editorTextareaRef?.setText) {
      editorTextareaRef.setText(value);
    }
  };

  const handleDelete = () => {
    const entries = envEntries();
    const selected = entries[selectedEnvIndex()];
    if (!selected) return;
    const [keyToDelete] = selected;
    const nextVars = Object.fromEntries(
      Object.entries(envVars()).filter(([k]) => k !== keyToDelete),
    );
    void saveEnvVars(nextVars);
  };

  const handleEditorSubmit = () => {
    const text = (pendingSubmitText ?? editorInput()).trim();
    pendingSubmitText = null;
    if (!text) return;

    if (editorState() === 'adding') {
      const separatorIndex = text.indexOf('=');
      if (separatorIndex <= 0) {
        setStatusIsError(true);
        setStatusMessage('Use KEY=VALUE format.');
        return;
      }
      const key = text.slice(0, separatorIndex).trim();
      const value = text.slice(separatorIndex + 1);
      if (!key) {
        setStatusIsError(true);
        setStatusMessage('Key cannot be empty.');
        return;
      }
      const nextVars = {
        ...envVars(),
        [key]: value,
      };
      setEditorState('viewing');
      setEditorInput('');
      setStatusMessage('');
      void saveEnvVars(nextVars);
      return;
    }

    if (editorState() === 'editing') {
      const key = editingKey();
      if (!key) return;
      const nextVars = {
        ...envVars(),
        [key]: text,
      };
      setEditorState('viewing');
      setEditorInput('');
      setEditingKey(null);
      setStatusMessage('');
      void saveEnvVars(nextVars);
    }
  };

  createEffect(() => {
    const total = envEntries().length;
    if (total === 0) {
      setSelectedEnvIndex(0);
      return;
    }
    setSelectedEnvIndex((prev) => Math.min(Math.max(prev, 0), total - 1));
  });

  createEffect(() => {
    const mode = editorState();
    const key = editingKey();
    const ref = editorTextareaRef;
    if (!ref?.setText) return;
    if (mode === 'adding') {
      ref.setText('');
      return;
    }
    if (mode === 'editing' && key) {
      ref.setText(envVars()[key] ?? '');
    }
  });

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    evt.stopPropagation?.();

    if (evt.name === 'escape') {
      if (view() === 'envvars' && editorState() !== 'viewing') {
        setEditorState('viewing');
        setEditingKey(null);
        setEditorInput('');
        pendingSubmitText = null;
        setStatusMessage('');
        return;
      }
      if (view() === 'envvars') {
        setView('projects');
        setSelectedProject(null);
        setSelectedEnvIndex(0);
        setEditorState('viewing');
        setEditingKey(null);
        setEditorInput('');
        pendingSubmitText = null;
        setStatusMessage('');
        return;
      }
      props.onClose();
      return;
    }

    if (view() === 'projects') {
      const list = projects();
      if (evt.name === 'up' || evt.name === 'k') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : list.length - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        setSelectedIndex((prev) => (prev < list.length - 1 ? prev + 1 : 0));
      } else if (evt.name === 'return' && list.length > 0) {
        const proj = list[selectedIndex()];
        if (proj) {
          setSelectedProject(proj);
          setView('envvars');
          setSelectedEnvIndex(0);
          setEditorState('viewing');
          setEditingKey(null);
          setEditorInput('');
          pendingSubmitText = null;
          setStatusMessage('');
          void loadEnvVars(proj);
        }
      }
    } else if (view() === 'envvars') {
      if (editorState() !== 'viewing') {
        return;
      }
      const entries = envEntries();
      if (evt.name === 'up' || evt.name === 'k') {
        if (entries.length === 0) return;
        setSelectedEnvIndex((prev) => (prev > 0 ? prev - 1 : entries.length - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        if (entries.length === 0) return;
        setSelectedEnvIndex((prev) => (prev < entries.length - 1 ? prev + 1 : 0));
      } else if (evt.name === 'a') {
        beginAdd();
      } else if (evt.name === 'e' || evt.name === 'return') {
        beginEdit();
      } else if (evt.name === 'd') {
        handleDelete();
      } else if (evt.name === 'v') {
        setShowValues((prev) => !prev);
      }
    }
  });

  return (
    <OverlayContainer title={overlayTitle()} width={70} responsive={true} footer={footerText()}>
      <Show when={view() === 'projects'}>
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
          <box flexDirection="column" height={contentHeight()} overflow="hidden">
            <For each={projects()}>
              {(project, index) => {
                const isSelected = () => index() === selectedIndex();
                return (
                  <box>
                    <text
                      backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                      fg={isSelected() ? theme.secondary : theme.text}
                      bold={isSelected()}
                    >
                      {isSelected() ? ' ▶ ' : '   '}
                      {truncate(project.name, 20).padEnd(20)}
                    </text>
                    <text fg={theme.textDim}> ({project.status})</text>
                  </box>
                );
              }}
            </For>
          </box>
        </Show>
      </Show>

      <Show when={view() === 'envvars'}>
        <Show when={envLoading()}>
          <box justifyContent="center">
            <Spinner color={theme.textMuted} />
            <text fg={theme.textMuted}> Loading environment variables...</text>
          </box>
        </Show>

        <Show when={!envLoading()}>
          {(() => {
            const entries = envEntries();
            if (entries.length === 0 && editorState() === 'viewing') {
              return (
                <text fg={theme.textDim} paddingLeft={2}>
                  No environment variables set. Press [a] to add one.
                </text>
              );
            }
            return (
              <box flexDirection="column" height={contentHeight()} overflow="hidden">
                <Show when={editorState() === 'viewing'}>
                  <For each={entries}>
                    {([key, value], index) => {
                      const isSelected = () => index() === selectedEnvIndex();
                      const sensitive = isSensitiveKey(key);
                      const displayValue = sensitive && !showValues() ? maskValue(value) : value;
                      return (
                        <box
                          paddingLeft={1}
                          backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                        >
                          <text
                            fg={isSelected() ? theme.secondary : theme.accent}
                            bold={isSelected()}
                          >
                            {isSelected() ? ' ▶ ' : '   '}
                            {truncate(key, 25).padEnd(25)}
                          </text>
                          <text
                            fg={isSelected() ? theme.secondary : theme.textDim}
                            bold={isSelected()}
                          >
                            {' = '}
                          </text>
                          <text
                            fg={
                              isSelected()
                                ? theme.secondary
                                : sensitive
                                  ? theme.warning
                                  : theme.textMuted
                            }
                            bold={isSelected()}
                          >
                            {truncate(displayValue, 30)}
                          </text>
                        </box>
                      );
                    }}
                  </For>
                </Show>

                <Show when={editorState() !== 'viewing'}>
                  <box flexDirection="column" gap={1} paddingLeft={1}>
                    <text fg={theme.text}>
                      {editorState() === 'adding'
                        ? 'Add env var (KEY=VALUE):'
                        : `Edit ${editingKey() ?? ''} value:`}
                    </text>
                    <textarea
                      ref={editorTextareaRef}
                      focused={true}
                      minHeight={1}
                      maxHeight={1}
                      width={contentWidth() - 6}
                      fg={theme.text}
                      backgroundColor={theme.backgroundElement}
                      keyBindings={[{ name: 'enter', action: 'submit' }]}
                      onKeyDown={(event: unknown) => {
                        const keyEvt = event as { name?: string };
                        if (keyEvt.name === 'enter' || keyEvt.name === 'return') {
                          pendingSubmitText = editorInput();
                        }
                      }}
                      onContentChange={() => {
                        const ref = editorTextareaRef as
                          | { plainText: string; setText?: (text: string) => void }
                          | undefined;
                        if (ref) {
                          setEditorInput(ref.plainText);
                        }
                      }}
                      onSubmit={handleEditorSubmit}
                    />
                  </box>
                </Show>

                <Show when={statusMessage().length > 0}>
                  <text fg={statusIsError() ? theme.error : theme.success} paddingLeft={1}>
                    {statusMessage()}
                  </text>
                </Show>
              </box>
            );
          })()}
        </Show>
      </Show>
    </OverlayContainer>
  );
}
