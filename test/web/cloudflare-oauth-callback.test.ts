import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const callbackScript = readFileSync('web/public/cloudflare-oauth-callback.js', 'utf-8');

function executeCallback(search: string) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const buttonListeners = new Map<string, () => void>();
  const scheduledTimeouts: Array<() => void> = [];
  const status = { textContent: '' };
  const returnButton = {
    hidden: true,
    addEventListener: vi.fn((name: string, listener: () => void) => {
      buttonListeners.set(name, listener);
    }),
  };
  const opener = {
    closed: false,
    focus: vi.fn(),
    postMessage: vi.fn(),
  };
  const history = { replaceState: vi.fn() };
  const close = vi.fn();
  const clearInterval = vi.fn();
  const clearTimeout = vi.fn();

  const window = {
    location: { search, pathname: '/cloudflare-oauth-callback.html' },
    opener,
    history,
    close,
    addEventListener: vi.fn((name: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(name, listener);
    }),
    setInterval: vi.fn(() => 11),
    clearInterval,
    setTimeout: vi.fn((listener: () => void) => {
      scheduledTimeouts.push(listener);
      return scheduledTimeouts.length + 20;
    }),
    clearTimeout,
  };

  runInNewContext(callbackScript, {
    URLSearchParams,
    document: {
      querySelector: (selector: string) =>
        selector === '#status' ? status : selector === '#return-button' ? returnButton : null,
    },
    window,
  });

  return {
    buttonListeners,
    clearInterval,
    clearTimeout,
    close,
    history,
    listeners,
    opener,
    returnButton,
    scheduledTimeouts,
    status,
  };
}

describe('Cloudflare OAuth publisher callback', () => {
  it('removes callback parameters and sends code/state only to its opener', () => {
    const harness = executeCallback('?code=authorization-code&state=expected-state');

    expect(harness.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/cloudflare-oauth-callback.html',
    );
    expect(harness.opener.postMessage).toHaveBeenCalledWith(
      {
        type: 'openlander:cloudflare-oauth',
        status: 'authorized',
        code: 'authorization-code',
        state: 'expected-state',
      },
      '*',
    );
    expect(harness.status.textContent).toBe('Authorization complete. Returning to OpenLander…');
  });

  it('accepts an acknowledgement only from the exact opener with matching state', () => {
    const harness = executeCallback('?code=authorization-code&state=expected-state');
    const onMessage = harness.listeners.get('message');
    expect(onMessage).toBeDefined();

    onMessage?.({
      source: {},
      data: { type: 'openlander:cloudflare-oauth:ack', state: 'expected-state' },
    });
    onMessage?.({
      source: harness.opener,
      data: { type: 'openlander:cloudflare-oauth:ack', state: 'wrong-state' },
    });
    expect(harness.clearInterval).not.toHaveBeenCalled();

    onMessage?.({
      source: harness.opener,
      data: { type: 'openlander:cloudflare-oauth:ack', state: 'expected-state' },
    });
    expect(harness.clearInterval).toHaveBeenCalledWith(11);
    expect(harness.clearTimeout).toHaveBeenCalled();
    expect(harness.status.textContent).toBe('Authorization complete. You can close this window.');

    harness.scheduledTimeouts.at(-1)?.();
    expect(harness.close).toHaveBeenCalled();
  });

  it('returns provider errors without storing them in browser storage', () => {
    const harness = executeCallback(
      '?error=access_denied&error_description=Authorization+was+cancelled&state=expected-state',
    );

    expect(harness.opener.postMessage).toHaveBeenCalledWith(
      {
        type: 'openlander:cloudflare-oauth',
        state: 'expected-state',
        error: 'access_denied',
        error_description: 'Authorization was cancelled',
      },
      '*',
    );
    expect(harness.returnButton.hidden).toBe(false);
  });
});
