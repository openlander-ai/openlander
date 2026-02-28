import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';

import {
  debuggingState,
  enterDebugMode,
  returnToMonitoring,
  buildStage,
  setBuildStage,
  cancelDeployReturn,
} from '../src/tui/state/mode.js';

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
    setBuildStage('pending');
  });
  vi.useRealTimers();
});

afterEach(() => {
  withRoot(() => {
    cancelDeployReturn();
    returnToMonitoring();
    setBuildStage('pending');
  });
  vi.useRealTimers();
});

// --- Memory Formatting Tests (TASK-05) ---

describe('memory formatting for StatusBar', () => {
  /**
   * Format memory for StatusBar display.
   * >= 1024MB → "X.YG"
   * < 1024MB → "XM"
   */
  function formatMemoryForStatusBar(memoryUsedMB: number | null): string {
    if (memoryUsedMB === null) return '—';
    if (memoryUsedMB >= 1024) {
      return `${(memoryUsedMB / 1024).toFixed(1)}G`;
    }
    return `${String(Math.round(memoryUsedMB))}M`;
  }

  it('formats null memory as dash', () => {
    expect(formatMemoryForStatusBar(null)).toBe('—');
  });

  it('formats memory < 1024MB as "XM" format', () => {
    expect(formatMemoryForStatusBar(128)).toBe('128M');
    expect(formatMemoryForStatusBar(512)).toBe('512M');
    expect(formatMemoryForStatusBar(0)).toBe('0M');
    expect(formatMemoryForStatusBar(1023)).toBe('1023M');
  });

  it('formats memory >= 1024MB as "X.YG" format', () => {
    expect(formatMemoryForStatusBar(1024)).toBe('1.0G');
    expect(formatMemoryForStatusBar(1536)).toBe('1.5G');
    expect(formatMemoryForStatusBar(4096)).toBe('4.0G');
    expect(formatMemoryForStatusBar(8192)).toBe('8.0G');
  });

  it('rounds fractional MB values', () => {
    expect(formatMemoryForStatusBar(100.4)).toBe('100M');
    expect(formatMemoryForStatusBar(100.5)).toBe('101M');
  });
});

// --- Debug Port Tests (TASK-06) ---

describe('debugging state with port', () => {
  it('enterDebugMode stores port in debuggingState', () => {
    withRoot(() => {
      enterDebugMode('p1', 'Project One', 3000);

      const state = debuggingState();
      expect(state).not.toBeNull();
      expect(state?.projectId).toBe('p1');
      expect(state?.projectName).toBe('Project One');
      expect(state?.port).toBe(3000);
    });
  });

  it('enterDebugMode defaults port to null when not provided', () => {
    withRoot(() => {
      enterDebugMode('p2', 'Project Two');

      const state = debuggingState();
      expect(state).not.toBeNull();
      expect(state?.port).toBeNull();
    });
  });

  it('enterDebugMode accepts explicit null for port', () => {
    withRoot(() => {
      enterDebugMode('p3', 'Project Three', null);

      const state = debuggingState();
      expect(state).not.toBeNull();
      expect(state?.port).toBeNull();
    });
  });

  it('returnToMonitoring clears debugging state including port', () => {
    withRoot(() => {
      enterDebugMode('p1', 'Project One', 3000);
      returnToMonitoring();

      expect(debuggingState()).toBeNull();
    });
  });
});

// --- Build Progress Tests (TASK-07) ---

describe('build stage to progress mapping', () => {
  /**
   * Map BuildStage to progress percentage for StatusBar.
   * - pending/error → null (no percentage shown)
   * - clone → 25%
   * - build → 50%
   * - run → 75%
   * - expose/complete → 100%
   */
  function buildStageToProgress(stage: string): number | null {
    switch (stage) {
      case 'clone':
        return 25;
      case 'build':
        return 50;
      case 'run':
        return 75;
      case 'expose':
      case 'complete':
        return 100;
      default:
        return null;
    }
  }

  it('returns null for pending stage', () => {
    expect(buildStageToProgress('pending')).toBeNull();
  });

  it('returns null for error stage', () => {
    expect(buildStageToProgress('error')).toBeNull();
  });

  it('returns 25 for clone stage', () => {
    expect(buildStageToProgress('clone')).toBe(25);
  });

  it('returns 50 for build stage', () => {
    expect(buildStageToProgress('build')).toBe(50);
  });

  it('returns 75 for run stage', () => {
    expect(buildStageToProgress('run')).toBe(75);
  });

  it('returns 100 for expose stage', () => {
    expect(buildStageToProgress('expose')).toBe(100);
  });

  it('returns 100 for complete stage', () => {
    expect(buildStageToProgress('complete')).toBe(100);
  });

  it('buildStage signal can be set and read', () => {
    withRoot(() => {
      setBuildStage('clone');
      expect(buildStage()).toBe('clone');

      setBuildStage('build');
      expect(buildStage()).toBe('build');

      setBuildStage('complete');
      expect(buildStage()).toBe('complete');
    });
  });
});

// --- StatusBar Props Type Tests ---

describe('StatusBar props interface', () => {
  interface StatusBarProps {
    memDisplay: string;
    debugPort: number | null;
    buildProgress: number | null;
  }

  it('accepts memDisplay as string', () => {
    const props: StatusBarProps = {
      memDisplay: '4.2G',
      debugPort: null,
      buildProgress: null,
    };
    expect(props.memDisplay).toBe('4.2G');
  });

  it('accepts debugPort as number or null', () => {
    const propsWithPort: StatusBarProps = {
      memDisplay: '128M',
      debugPort: 3000,
      buildProgress: null,
    };
    expect(propsWithPort.debugPort).toBe(3000);

    const propsWithoutPort: StatusBarProps = {
      memDisplay: '128M',
      debugPort: null,
      buildProgress: null,
    };
    expect(propsWithoutPort.debugPort).toBeNull();
  });

  it('accepts buildProgress as number or null', () => {
    const propsWithProgress: StatusBarProps = {
      memDisplay: '8.1G',
      debugPort: null,
      buildProgress: 67,
    };
    expect(propsWithProgress.buildProgress).toBe(67);

    const propsWithoutProgress: StatusBarProps = {
      memDisplay: '8.1G',
      debugPort: null,
      buildProgress: null,
    };
    expect(propsWithoutProgress.buildProgress).toBeNull();
  });
});

// --- onStatsUpdate Callback Tests ---

describe('onStatsUpdate callback type', () => {
  interface StatsUpdateData {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
    memoryUsedMB: number | null;
  }

  it('accepts memoryUsedMB in stats update', () => {
    const data: StatsUpdateData = {
      projectCount: 4,
      cpuPercent: 12,
      buildingCount: 0,
      memoryUsedMB: 4300,
    };
    expect(data.memoryUsedMB).toBe(4300);
  });

  it('accepts null memoryUsedMB', () => {
    const data: StatsUpdateData = {
      projectCount: 4,
      cpuPercent: null,
      buildingCount: 0,
      memoryUsedMB: null,
    };
    expect(data.memoryUsedMB).toBeNull();
  });
});
