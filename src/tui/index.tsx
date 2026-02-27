import process from 'node:process';
import { join } from 'node:path';
import { appendFileSync, writeFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    // ── Nuclear terminal restore ────────────────────────────────────────────
    // OpenTUI's zig renderer enables mouse tracking, bracketed paste, raw mode,
    // and alt screen via native code. Our process.exit() kills the process before
    // the zig cleanup can run. So we bypass all Node/Bun buffering:
    //   1. writeSync(fd=1) → direct syscall, cannot be intercepted or buffered
    //   2. stty sane → external subprocess that resets terminal discipline

    // Direct fd write — guaranteed delivery to terminal
    try {
      writeSync(
        1,
        '\x1b[?1000l' + // Disable normal mouse tracking
          '\x1b[?1002l' + // Disable button-event mouse tracking
          '\x1b[?1003l' + // Disable any-event mouse tracking
          '\x1b[?1006l' + // Disable SGR extended mouse mode
          '\x1b[?2004l' + // Disable bracketed paste mode
          '\x1b[?25h' + // Show cursor
          '\x1b[?1049l' + // Exit alternate screen buffer
          '\x1b[0m', // Reset character attributes
      );
    } catch {
      /* fd may already be closed */
    }

    // Reset terminal discipline via external command (raw mode, echo, signals)
    try {
      spawnSync('stty', ['sane'], { stdio: 'inherit' });
    } catch {
      /* ignore */
    }

    // Print clean exit message (also via direct fd write)
    const logo = [
      '',
      '  \x1b[38;2;250;178;131m╔═══════════════════════════════╗\x1b[0m',
      `  \x1b[38;2;250;178;131m║\x1b[0m   OpenLander v${VERSION}${' '.repeat(Math.max(0, 13 - VERSION.length))}\x1b[38;2;250;178;131m║\x1b[0m`,
      '  \x1b[38;2;250;178;131m║\x1b[0m   \x1b[2mSession ended\x1b[0m               \x1b[38;2;250;178;131m║\x1b[0m',
      '  \x1b[38;2;250;178;131m╚═══════════════════════════════╝\x1b[0m',
      '',
    ];
    try {
      writeSync(1, logo.join('\n') + '\n');
    } catch {
      /* ignore */
    }

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
