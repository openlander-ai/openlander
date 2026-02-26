import process from 'node:process';
import { render } from 'ink';
import type { AppContext } from '../app.js';
import { App } from './App.js';

/**
 * Start the OpenLander Terminal UI.
 *
 * - Enters alternate screen buffer (hides previous terminal content)
 * - Renders fullscreen Ink app
 * - On exit, restores original terminal and prints session info
 */
export function startTUI(ctx: AppContext): void {
  // Signal to other modules that TUI is running (e.g. suppress Hono HTTP logs)
  process.env['OPENLANDER_TUI'] = '1';

  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');

  const instance = render(<App ctx={ctx} />, {
    patchConsole: true,
    exitOnCtrlC: false,
  });

  const cleanup = () => {
    instance.unmount();

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
  };

  // Handle exit signals
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Handle normal Ink exit (e.g. from useApp().exit())
  void instance.waitUntilExit().then(() => {
    cleanup();
    process.exit(0);
  });
}
