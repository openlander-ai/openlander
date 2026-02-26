import process from 'node:process';
import { join } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { render } from '@opentui/solid';
import type { AppContext } from '../app.js';
import { getDataDir } from '../config/index.js';
import { App } from './App.js';
import { ExitProvider } from './context/exit.js';
import { VERSION } from '../version.js';

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

  // --- Error logging to file (so user can read after TUI exits) ---
  const logPath = join(getDataDir(), 'error.log');
  writeFileSync(logPath, `[${new Date().toISOString()}] OpenLander TUI started\n`);

  const logError = (prefix: string, err: unknown) => {
    const msg = err instanceof Error ? `${err.message}\n${String(err.stack)}` : String(err);
    try {
      appendFileSync(logPath, `[${new Date().toISOString()}] ${prefix}: ${msg}\n`);
    } catch {
      // Ignore write failures — logging is best-effort
    }
  };

  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logError(
      'console.error',
      args
        .map((a) => {
          if (a === null || a === undefined) return String(a);
          if (typeof a === 'object') return JSON.stringify(a);
          return String(a as string | number | boolean | bigint);
        })
        .join(' '),
    );
    origConsoleError.apply(console, args);
  };

  process.on('uncaughtException', (e) => {
    logError('uncaughtException', e);
  });
  process.on('unhandledRejection', (e) => {
    logError('unhandledRejection', e);
  });

  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');

  const cleanup = () => {
    // Leave alternate screen buffer — restores original terminal
    process.stdout.write('\x1b[?1049l');

    // Print clean exit message
    const logo = [
      '',
      '  \x1b[38;2;250;178;131m╔═══════════════════════════════╗\x1b[0m',
      `  \x1b[38;2;250;178;131m║\x1b[0m   OpenLander v${VERSION}${' '.repeat(Math.max(0, 13 - VERSION.length))}\x1b[38;2;250;178;131m║\x1b[0m`,
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
