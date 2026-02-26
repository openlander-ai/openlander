import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { Spinner } from '../components/Spinner.js';

import type { ScreenProps } from './index.js';

type TraefikState = 'checking' | 'already_running' | 'starting' | 'started' | 'failed';

/**
 * TraefikSetup screen - auto-starts Traefik reverse proxy.
 * Non-fatal if it fails.
 */
export function TraefikSetup({ ctx, onNext }: ScreenProps): JSX.Element {
  const [state, setState] = createSignal<TraefikState>('checking');
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const setupTraefik = async () => {
      try {
        // Check if already running
        const isRunning = await ctx.traefik.isRunning();
        if (isRunning) {
          setState('already_running');
          // Auto-advance after 1.5s
          const timer = setTimeout(() => {
            onNext();
          }, 1500);
          onCleanup(() => {
            clearTimeout(timer);
          });
          return;
        }

        // Try to start
        setState('starting');
        await ctx.traefik.start();
        setState('started');
        // Auto-advance after 1.5s
        const timer = setTimeout(() => {
          onNext();
        }, 1500);
        onCleanup(() => {
          clearTimeout(timer);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start Traefik');
        setState('failed');
        // Non-fatal - proceed anyway after 2s
        const timer = setTimeout(() => {
          onNext();
        }, 2000);
        onCleanup(() => {
          clearTimeout(timer);
        });
      }
    };

    void setupTraefik();
  });

  const renderContent = (): JSX.Element => {
    switch (state()) {
      case 'checking':
        return (
          <box>
            <text fg="yellow">
              <Spinner />
            </text>
            <text> Checking Traefik...</text>
          </box>
        );

      case 'already_running':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text fg="green">✅ Traefik already running</text>
            </box>
            <box marginTop={1}>
              <text dim={true}>Continuing...</text>
            </box>
          </box>
        );

      case 'starting':
        return (
          <box>
            <text fg="yellow">
              <Spinner />
            </text>
            <text> Starting Traefik...</text>
          </box>
        );

      case 'started':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text fg="green">✅ Traefik started</text>
            </box>
            <box marginTop={1}>
              <text dim={true}>Continuing...</text>
            </box>
          </box>
        );

      case 'failed':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text fg="yellow">⚠️ Traefik could not start</text>
            </box>
            {error() && (
              <box marginBottom={1}>
                <text dim={true}>{error()}</text>
              </box>
            )}
            <box>
              <text dim={true}>Continuing anyway (port 80 features may not work)...</text>
            </box>
          </box>
        );

      default:
        return <box />;
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
          <text bold={true} fg="cyan">
            [4/5] Setting up Traefik...
          </text>
        </box>

        <box marginTop={2}>{renderContent()}</box>
      </box>
    </box>
  );
}
