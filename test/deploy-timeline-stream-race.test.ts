import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  markAgentStarted,
  shouldSuppressAgentEvent,
} from '../src/web/api/deploy-timeline-stream-routes.js';

describe('deploy timeline stream race guards', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('thinking event sets agentStarted = true', () => {
    const deployState = {
      agentStarted: false,
      fallbackTriggered: false,
    };
    const fallbackTimerRef = {
      fallbackTimer: null as ReturnType<typeof setTimeout> | null,
    };

    markAgentStarted(deployState, 'thinking', fallbackTimerRef);

    expect(deployState.agentStarted).toBe(true);
  });

  it('clears fallback timer when agent starts for first time', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const deployState = {
      agentStarted: false,
      fallbackTriggered: false,
    };
    const fallbackTimerRef = {
      fallbackTimer: setTimeout(() => undefined, 5000),
    };

    markAgentStarted(deployState, 'thinking', fallbackTimerRef);
    markAgentStarted(deployState, 'message', fallbackTimerRef);

    expect(deployState.agentStarted).toBe(true);
    expect(fallbackTimerRef.fallbackTimer).toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses agent events after fallback is triggered', () => {
    const deployState = {
      agentStarted: false,
      fallbackTriggered: true,
    };

    expect(shouldSuppressAgentEvent(deployState)).toBe(true);
  });
});
