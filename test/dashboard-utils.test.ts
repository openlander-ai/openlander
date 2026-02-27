import { describe, it, expect } from 'vitest';

import {
  miniBar,
  getColorForPercent,
  formatMemory,
  formatUptime,
  truncate,
  formatTime,
  getActivityIcon,
  getActivityColor,
  PROJECT_STATUS_ICON,
  PROJECT_STATUS_COLOR,
  ACTIVITY_ICON,
  ACTIVITY_COLOR,
} from '../src/tui/dashboard-utils.js';

import { theme } from '../src/tui/theme.js';

// ---------------------------------------------------------------------------
// Constants Tests
// ---------------------------------------------------------------------------

describe('Constants', () => {
  describe('PROJECT_STATUS_ICON', () => {
    it('has correct icon for running', () => {
      expect(PROJECT_STATUS_ICON['running']).toBe('●');
    });

    it('has correct icon for building', () => {
      expect(PROJECT_STATUS_ICON['building']).toBe('◐');
    });

    it('has correct icon for stopped', () => {
      expect(PROJECT_STATUS_ICON['stopped']).toBe('○');
    });

    it('has correct icon for error', () => {
      expect(PROJECT_STATUS_ICON['error']).toBe('✖');
    });
  });

  describe('PROJECT_STATUS_COLOR', () => {
    it('maps running to theme.statusRunning', () => {
      expect(PROJECT_STATUS_COLOR['running']).toBe(theme.statusRunning);
    });

    it('maps building to theme.statusBuilding', () => {
      expect(PROJECT_STATUS_COLOR['building']).toBe(theme.statusBuilding);
    });

    it('maps stopped to theme.statusStopped', () => {
      expect(PROJECT_STATUS_COLOR['stopped']).toBe(theme.statusStopped);
    });

    it('maps error to theme.statusError', () => {
      expect(PROJECT_STATUS_COLOR['error']).toBe(theme.statusError);
    });
  });

  describe('ACTIVITY_ICON', () => {
    it('has success icon', () => {
      expect(ACTIVITY_ICON['success']).toBe('✅');
    });

    it('has progress icon', () => {
      expect(ACTIVITY_ICON['progress']).toBe('🔄');
    });

    it('has error icon', () => {
      expect(ACTIVITY_ICON['error']).toBe('❌');
    });

    it('has info icon', () => {
      expect(ACTIVITY_ICON['info']).toBe('ℹ️');
    });
  });

  describe('ACTIVITY_COLOR', () => {
    it('maps success to theme.success', () => {
      expect(ACTIVITY_COLOR['success']).toBe(theme.success);
    });

    it('maps progress to theme.progress', () => {
      expect(ACTIVITY_COLOR['progress']).toBe(theme.progress);
    });

    it('maps error to theme.error', () => {
      expect(ACTIVITY_COLOR['error']).toBe(theme.error);
    });

    it('maps info to theme.info', () => {
      expect(ACTIVITY_COLOR['info']).toBe(theme.info);
    });
  });
});

// ---------------------------------------------------------------------------
// miniBar Tests
// ---------------------------------------------------------------------------

describe('miniBar', () => {
  it('returns empty bars for 0%', () => {
    expect(miniBar(0)).toBe('◻◻◻');
  });

  it('returns empty bars for very low percentage', () => {
    expect(miniBar(10)).toBe('◻◻◻');
  });

  it('returns one filled block for 33%', () => {
    expect(miniBar(33)).toBe('◼◻◻');
  });

  it('returns one filled block for 50%', () => {
    expect(miniBar(50)).toBe('◼◼◻');
  });

  it('returns two filled blocks for 67%', () => {
    expect(miniBar(67)).toBe('◼◼◻');
  });

  it('returns all filled blocks for 100%', () => {
    expect(miniBar(100)).toBe('◼◼◼');
  });

  it('returns all filled blocks for 99%', () => {
    expect(miniBar(99)).toBe('◼◼◼');
  });
});

// ---------------------------------------------------------------------------
// getColorForPercent Tests
// ---------------------------------------------------------------------------

describe('getColorForPercent', () => {
  it('returns green for low percentage (30%)', () => {
    expect(getColorForPercent(30)).toBe(theme.resourceOk);
  });

  it('returns green for exactly 60%', () => {
    expect(getColorForPercent(60)).toBe(theme.resourceOk);
  });

  // Boundary tests: 60% threshold
  it('returns green for 59% (just below 60%)', () => {
    expect(getColorForPercent(59)).toBe(theme.resourceOk);
  });

  it('returns yellow for 61% (just above 60%)', () => {
    expect(getColorForPercent(61)).toBe(theme.resourceWarn);
  });

  it('returns yellow for 70%', () => {
    expect(getColorForPercent(70)).toBe(theme.resourceWarn);
  });

  it('returns yellow for exactly 80%', () => {
    expect(getColorForPercent(80)).toBe(theme.resourceWarn);
  });

  // Boundary tests: 80% threshold
  it('returns yellow for 79% (just below 80%)', () => {
    expect(getColorForPercent(79)).toBe(theme.resourceWarn);
  });

  it('returns red for 81% (just above 80%)', () => {
    expect(getColorForPercent(81)).toBe(theme.resourceCrit);
  });

  it('returns red for 90%', () => {
    expect(getColorForPercent(90)).toBe(theme.resourceCrit);
  });

  it('returns red for 100%', () => {
    expect(getColorForPercent(100)).toBe(theme.resourceCrit);
  });

  it('returns green for 0%', () => {
    expect(getColorForPercent(0)).toBe(theme.resourceOk);
  });
});

// ---------------------------------------------------------------------------
// formatMemory Tests
// ---------------------------------------------------------------------------

describe('formatMemory', () => {
  it('formats 512 MB as 0.5', () => {
    expect(formatMemory(512)).toBe('0.5');
  });

  it('formats 1024 MB as 1.0', () => {
    expect(formatMemory(1024)).toBe('1.0');
  });

  it('formats 2048 MB as 2.0', () => {
    expect(formatMemory(2048)).toBe('2.0');
  });

  it('formats 1536 MB as 1.5', () => {
    expect(formatMemory(1536)).toBe('1.5');
  });

  it('formats 0 MB as 0.0', () => {
    expect(formatMemory(0)).toBe('0.0');
  });
});

// ---------------------------------------------------------------------------
// formatUptime Tests
// ---------------------------------------------------------------------------

describe('formatUptime', () => {
  it('formats 90 seconds as 0h 1m', () => {
    expect(formatUptime(90)).toBe('0h 1m');
  });

  it('formats 3661 seconds as 1h 1m', () => {
    expect(formatUptime(3661)).toBe('1h 1m');
  });

  it('formats 3600 seconds as 1h 0m', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
  });

  it('formats 86400 seconds (1 day) as 1d 0h', () => {
    expect(formatUptime(86400)).toBe('1d 0h');
  });

  it('formats 90000 seconds as 1d 1h', () => {
    expect(formatUptime(90000)).toBe('1d 1h');
  });

  it('formats 0 seconds as 0h 0m', () => {
    expect(formatUptime(0)).toBe('0h 0m');
  });
});

// ---------------------------------------------------------------------------
// truncate Tests
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns original string if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when exceeding limit', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('truncates exactly at boundary', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates to minimal length (3 for ellipsis)', () => {
    expect(truncate('abcdefghij', 5)).toBe('ab...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles string equal to maxLen', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

// ---------------------------------------------------------------------------
// formatTime Tests
// ---------------------------------------------------------------------------

describe('formatTime', () => {
  it('formats timestamp to HH:MM format', () => {
    const result = formatTime('2024-01-15T14:30:00Z');
    // Result depends on local timezone, but should match HH:MM pattern
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('pads hours with zero', () => {
    const result = formatTime('2024-01-15T09:05:00Z');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
    // Hours should be 2 digits
    const [hours] = result.split(':');
    expect(hours).toHaveLength(2);
  });

  it('pads minutes with zero', () => {
    const result = formatTime('2024-01-15T14:05:00Z');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
    // Minutes should be 2 digits
    const [, mins] = result.split(':');
    expect(mins).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getActivityIcon Tests
// ---------------------------------------------------------------------------

describe('getActivityIcon', () => {
  it('returns error icon for message with "error"', () => {
    expect(getActivityIcon('deployment error occurred')).toBe('❌');
  });

  it('returns error icon for message with "failed"', () => {
    expect(getActivityIcon('build failed')).toBe('❌');
  });

  it('returns progress icon for message with "started"', () => {
    expect(getActivityIcon('build started')).toBe('🔄');
  });

  it('returns progress icon for message with "building"', () => {
    expect(getActivityIcon('currently building')).toBe('🔄');
  });

  it('returns progress icon for message with "progress"', () => {
    expect(getActivityIcon('in progress')).toBe('🔄');
  });

  it('returns success icon for message with "success"', () => {
    expect(getActivityIcon('operation success')).toBe('✅');
  });

  it('returns success icon for message with "deployed"', () => {
    expect(getActivityIcon('successfully deployed')).toBe('✅');
  });

  it('returns success icon for message with "updated"', () => {
    expect(getActivityIcon('config updated')).toBe('✅');
  });

  it('returns success icon for message with "completed"', () => {
    expect(getActivityIcon('task completed')).toBe('✅');
  });

  it('returns info icon for random message', () => {
    expect(getActivityIcon('random info message')).toBe('ℹ️');
  });

  it('is case insensitive', () => {
    expect(getActivityIcon('ERROR')).toBe('❌');
    expect(getActivityIcon('DEPLOYED')).toBe('✅');
  });
});

// ---------------------------------------------------------------------------
// getActivityColor Tests
// ---------------------------------------------------------------------------

describe('getActivityColor', () => {
  it('returns error color for message with "error"', () => {
    expect(getActivityColor('deployment error')).toBe(theme.error);
  });

  it('returns error color for message with "failed"', () => {
    expect(getActivityColor('build failed')).toBe(theme.error);
  });

  it('returns progress color for message with "started"', () => {
    expect(getActivityColor('build started')).toBe(theme.progress);
  });

  it('returns progress color for message with "building"', () => {
    expect(getActivityColor('currently building')).toBe(theme.progress);
  });

  it('returns success color for message with "deployed"', () => {
    expect(getActivityColor('successfully deployed')).toBe(theme.success);
  });

  it('returns success color for message with "completed"', () => {
    expect(getActivityColor('task completed')).toBe(theme.success);
  });

  it('returns info color for random message', () => {
    expect(getActivityColor('random info')).toBe(theme.info);
  });

  it('is case insensitive', () => {
    expect(getActivityColor('ERROR')).toBe(theme.error);
    expect(getActivityColor('DEPLOYED')).toBe(theme.success);
  });
});
