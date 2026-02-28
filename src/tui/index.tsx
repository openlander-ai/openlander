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
 * Following OpenCode's pattern: let OpenTUI handle terminal lifecycle.
 * - OpenTUI's zig renderer manages alt screen, mouse, paste, raw mode
 * - OpenTUI's SIGINT handler calls destroy() for clean exit
 * - We do NOT manually enter alt screen or register conflicting signal handlers
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

  // ── Exit cleanup (safety net) ─────────────────────────────────────────────
  // OpenTUI's destroy() handles terminal restoration via zig native code.
  // This 'exit' handler is a safety net in case destroy() didn't fully run.
  let exitHandled = false;
  process.on('exit', () => {
    if (exitHandled) return;
    exitHandled = true;
    try {
      writeSync(
        1,
        '\x1b[?1000l' +
          '\x1b[?1002l' +
          '\x1b[?1003l' +
          '\x1b[?1006l' +
          '\x1b[?2004l' +
          '\x1b[?25h' +
          '\x1b[?1049l' +
          '\x1b[0m',
      );
    } catch {
      /* fd may already be closed */
    }
    try {
      spawnSync('stty', ['sane'], { stdio: 'inherit' });
    } catch {
      /* stty may not be available */
    }
    try {
      const logo = [
        '',
        '  \x1b[38;2;250;178;131m╔═══════════════════════════════╗\x1b[0m',
        `  \x1b[38;2;250;178;131m║\x1b[0m   OpenLander v${VERSION}${' '.repeat(Math.max(0, 16 - VERSION.length))}\x1b[38;2;250;178;131m║\x1b[0m`,
        '  \x1b[38;2;250;178;131m║\x1b[0m   \x1b[2mSession ended\x1b[0m               \x1b[38;2;250;178;131m║\x1b[0m',
        '  \x1b[38;2;250;178;131m╚═══════════════════════════════╝\x1b[0m',
        '',
      ];
      writeSync(1, logo.join('\n') + '\n');
    } catch {
      /* fd may already be closed */
    }
  });

  // ── NO manual alt screen entry ─────────────────────────────────────────────
  // OpenTUI's zig renderer enters alt screen during render().
  // We do NOT write \x1b[?1049h ourselves (was causing double-entry).

  // ── NO SIGINT/SIGTERM handlers ─────────────────────────────────────────────
  // OpenTUI registers its own SIGINT/SIGTERM handlers that call destroy().
  // Our previous handlers conflicted — process.exit(0) killed the process
  // before zig cleanup could run. Now we let OpenTUI handle it exclusively.

  render(
    () => (
      <ExitProvider onExit={() => process.exit(0)}>
        <App ctx={ctx} />
      </ExitProvider>
    ),
    {
      exitOnCtrlC: false, // Let OpenTUI's SIGNAL handler handle Ctrl+C (same as OpenCode)
    },
  );
}
