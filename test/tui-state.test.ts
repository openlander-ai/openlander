import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';

import {
  activeBuildSession,
  buildSessionCount,
  buildSessions,
  cancelDeployReturn,
  debuggingState,
  deployingState,
  enterDebugMode,
  enterDeployMode,
  mode,
  nextBuildSession,
  prevBuildSession,
  returnToMonitoring,
  scheduleDeployReturn,
  selectedBuildIndex,
} from '../src/tui/state/mode.js';
import { focus, focusChat, focusStatus, toggleFocus } from '../src/tui/state/focus.js';
import { overlayActive, setOverlayActive } from '../src/tui/state/overlay.js';

function withRoot(fn: () => void): void {
  createRoot((dispose) => {
    fn();
    dispose();
  });
}

beforeEach(() => {
  withRoot(() => {
    cancelDeployReturn();
    returnToMonitoring();
    focusChat();
    setOverlayActive(false);
  });
  vi.useRealTimers();
});

afterEach(() => {
  withRoot(() => {
    cancelDeployReturn();
    returnToMonitoring();
    focusChat();
    setOverlayActive(false);
  });
  vi.useRealTimers();
});

describe('tui state: mode', () => {
  it('enterDeployMode sets mode to deploying and adds build session', () => {
    withRoot(() => {
      enterDeployMode('p1', 'Project One');

      expect(mode()).toBe('deploying');
      expect(deployingState()).toEqual({ projectId: 'p1', projectName: 'Project One' });
      expect(buildSessionCount()).toBe(1);
      expect(buildSessions()).toEqual([{ projectId: 'p1', projectName: 'Project One' }]);
      expect(activeBuildSession()).toEqual({ projectId: 'p1', projectName: 'Project One' });
      expect(selectedBuildIndex()).toBe(0);
    });
  });

  it("enterDeployMode with same projectId doesn't create duplicate session", () => {
    withRoot(() => {
      enterDeployMode('p1', 'Project One');
      enterDeployMode('p1', 'Project One Duplicate Name');

      expect(buildSessionCount()).toBe(1);
      expect(buildSessions()).toEqual([{ projectId: 'p1', projectName: 'Project One' }]);
      expect(selectedBuildIndex()).toBe(0);
    });
  });

  it('enterDebugMode sets mode to debugging', () => {
    withRoot(() => {
      enterDebugMode('p2', 'Project Two');

      expect(mode()).toBe('debugging');
      expect(debuggingState()).toEqual({ projectId: 'p2', projectName: 'Project Two', port: null });
    });
  });

  it('returnToMonitoring resets all mode state', () => {
    withRoot(() => {
      enterDeployMode('p1', 'Project One');
      enterDeployMode('p2', 'Project Two');
      enterDebugMode('p2', 'Project Two');

      returnToMonitoring();

      expect(mode()).toBe('monitoring');
      expect(deployingState()).toBeNull();
      expect(debuggingState()).toBeNull();
      expect(buildSessions()).toEqual([]);
      expect(buildSessionCount()).toBe(0);
      expect(selectedBuildIndex()).toBe(0);
      expect(activeBuildSession()).toBeNull();
    });
  });

  it('nextBuildSession and prevBuildSession cycle through sessions', () => {
    withRoot(() => {
      enterDeployMode('p1', 'Project One');
      enterDeployMode('p2', 'Project Two');
      enterDeployMode('p3', 'Project Three');

      expect(activeBuildSession()).toEqual({ projectId: 'p3', projectName: 'Project Three' });

      nextBuildSession();
      expect(activeBuildSession()).toEqual({ projectId: 'p1', projectName: 'Project One' });
      expect(deployingState()).toEqual({ projectId: 'p1', projectName: 'Project One' });

      nextBuildSession();
      expect(activeBuildSession()).toEqual({ projectId: 'p2', projectName: 'Project Two' });

      prevBuildSession();
      expect(activeBuildSession()).toEqual({ projectId: 'p1', projectName: 'Project One' });

      prevBuildSession();
      expect(activeBuildSession()).toEqual({ projectId: 'p3', projectName: 'Project Three' });
    });
  });

  it('scheduleDeployReturn auto-returns to monitoring after delay', () => {
    withRoot(() => {
      vi.useFakeTimers();
      enterDeployMode('p1', 'Project One');

      scheduleDeployReturn(3);
      vi.advanceTimersByTime(2999);
      expect(mode()).toBe('deploying');

      vi.advanceTimersByTime(1);
      expect(mode()).toBe('monitoring');
      expect(buildSessionCount()).toBe(0);
    });
  });

  it('cancelDeployReturn prevents auto-return', () => {
    withRoot(() => {
      vi.useFakeTimers();
      enterDeployMode('p1', 'Project One');

      scheduleDeployReturn(1);
      cancelDeployReturn();
      vi.advanceTimersByTime(1000);

      expect(mode()).toBe('deploying');
      expect(buildSessionCount()).toBe(1);
    });
  });
});

describe('tui state: focus', () => {
  it('focus defaults to chat', () => {
    withRoot(() => {
      expect(focus()).toBe('chat');
    });
  });

  it('toggleFocus toggles between chat and status', () => {
    withRoot(() => {
      expect(focus()).toBe('chat');

      toggleFocus();
      expect(focus()).toBe('status');

      toggleFocus();
      expect(focus()).toBe('chat');
    });
  });

  it('focusChat and focusStatus set explicit focus', () => {
    withRoot(() => {
      focusStatus();
      expect(focus()).toBe('status');

      focusChat();
      expect(focus()).toBe('chat');
    });
  });
});

describe('tui state: overlay', () => {
  it('overlayActive defaults to false', () => {
    withRoot(() => {
      expect(overlayActive()).toBe(false);
    });
  });

  it('setOverlayActive updates overlay active state', () => {
    withRoot(() => {
      setOverlayActive(true);
      expect(overlayActive()).toBe(true);

      setOverlayActive(false);
      expect(overlayActive()).toBe(false);
    });
  });
});
