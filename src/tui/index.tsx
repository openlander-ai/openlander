import process from 'node:process';
import { render } from '@opentui/solid';
import type { AppContext } from '../app.js';
import { App } from './App.js';
import { ExitProvider } from './context/exit.js';

/**
 * Start the OpenLander Terminal UI.
 *
 * - Enters alternate screen buffer (hides previous terminal content)
 * - Renders fullscreen OpenTUI app
 * - On exit, restores original terminal and prints session info
 */
export function startTUI(ctx: AppContext): void {
  // Signal to other modules that TUI is running (e.g. suppress Hono HTTP logs)
  process.env['OPENLANDER_TUI'] = '1';

  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');

  const cleanup = () => {
    // Leave alternate screen buffer — restores original terminal
    process.stdout.write('\x1b[?1049l');

    // Print clean exit message
    const logo = [
      '',
      '  \x1b[38;2;250;178;131m╔═══════════════════════════════╗\x1b[0m',
      '  \x1b[38;2;250;178;131m║\x1b[0m   OpenLander v0.1.0           \x1b[38;2;250;178;131m║\x1b[0m',
      '  \x1b[38;2;250;178;131m║\x1b[0m   \x1b[2mSession ended\x1b[0m               \x1b[38;2;250;178;131m║\x1b[0m',
      '  \x1b[38;2;250;178;131m╚═══════════════════════════════╝\x1b[0m',
      '',
    ];
    process.stdout.write(logo.join('\n') + '\n');
    process.exit(0);
  };

  render(() => (
    <ExitProvider onExit={cleanup}>
      <App ctx={ctx} />
    </ExitProvider>
  ));

  // Handle exit signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
