import { render } from 'ink';
import type { AppContext } from '../app.js';
import { App } from './App.js';

/**
 * Start the OpenLander Terminal UI.
 *
 * Renders a fullscreen ink app with patchConsole to capture
 * any console.log output from the background HTTP server.
 */
export function startTUI(ctx: AppContext): void {
  render(<App ctx={ctx} />, { patchConsole: true });
}
