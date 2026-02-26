import { createSignal, createEffect } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { useExit } from '../context/exit.js';
import { Spinner } from '../components/Spinner.js';

import type { ScreenProps } from './index.js';
import type { DockerStatus } from '../../pipeline/docker.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

type CheckState = 'checking' | 'success' | 'not_installed' | 'not_running' | 'permission_denied';

/**
 * DockerCheck screen - auto-detects Docker installation and daemon status.
 */
export function DockerCheck({ ctx, onNext }: ScreenProps): JSX.Element {
  const { exit } = useExit();
  const [state, setState] = createSignal<CheckState>('checking');
  const [retryCount, setRetryCount] = createSignal(0);

  const checkDocker = async () => {
    setState('checking');
    try {
      const status: DockerStatus = await ctx.docker.status();

      if (status.state === 'running') {
        setState('success');
        setTimeout(() => {
          onNext();
        }, 1000);
      } else if (status.state === 'not_installed') {
        setState('not_installed');
      } else if (status.state === 'not_running') {
        setState('not_running');
      } else {
        setState('permission_denied');
      }
    } catch (err) {
      log.debug({ err }, 'Docker status check failed');
      setState('not_installed');
    }
  };

  createEffect(() => {
    // Track retryCount to re-trigger
    const _count = retryCount();
    void checkDocker();
  });

  useKeyboard((evt) => {
    if (state() === 'success') {
      if (evt.key === 'return') {
        onNext();
      }
      return;
    }

    if (evt.key === 'return') {
      setRetryCount((c) => c + 1);
    }
    if (evt.char?.toLowerCase() === 'q') {
      exit();
    }
  });

  const renderContent = (): JSX.Element => {
    switch (state()) {
      case 'checking':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text color="yellow">
                <Spinner />
              </text>
              <text> Checking Docker...</text>
            </box>
          </box>
        );

      case 'success':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text color="green">✅ Docker detected</text>
            </box>
            <box>
              <text color="green">✅ Docker daemon running</text>
            </box>
            <box marginTop={1}>
              <text dim={true}>Continuing automatically...</text>
            </box>
          </box>
        );

      case 'not_installed':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text color="red">❌ Docker not found</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>Please install Docker to continue:</text>
            </box>
            <box marginBottom={1}>
              <text color="cyan">https://docs.docker.com/get-docker/</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>Or run: curl -fsSL https://get.docker.com | sh</text>
            </box>
            <box marginTop={2}>
              <text color="cyan" bold={true}>
                [Enter]
              </text>
              <text> Retry</text>
              <text dim={true}> [q] Quit</text>
            </box>
          </box>
        );

      case 'not_running':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text color="yellow">⚠️ Docker installed but not running</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>Please start the Docker daemon:</text>
            </box>
            <box marginBottom={1}>
              <text color="cyan">sudo systemctl start docker</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>(or open Docker Desktop on macOS)</text>
            </box>
            <box marginTop={2}>
              <text color="cyan" bold={true}>
                [Enter]
              </text>
              <text> Retry</text>
              <text dim={true}> [q] Quit</text>
            </box>
          </box>
        );

      case 'permission_denied':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text color="yellow">⚠️ Docker permission denied</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>Add your user to the docker group:</text>
            </box>
            <box marginBottom={1}>
              <text color="cyan">sudo usermod -aG docker $USER</text>
            </box>
            <box marginBottom={1}>
              <text dim={true}>Then log out and back in.</text>
            </box>
            <box marginTop={2}>
              <text color="cyan" bold={true}>
                [Enter]
              </text>
              <text> Retry</text>
              <text dim={true}> [q] Quit</text>
            </box>
          </box>
        );
    }
  };

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <box
        flexDirection="column"
        alignItems="center"
        border="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <box marginBottom={1}>
          <text bold={true} color="cyan">
            [1/5] Checking Docker...
          </text>
        </box>
        <box marginTop={2}>{renderContent()}</box>
      </box>
    </box>
  );
}
