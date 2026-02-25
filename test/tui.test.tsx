import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Import pure functions from dashboard-utils
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

// Import theme for assertions
import { theme } from '../src/tui/theme.js';

// Import components for rendering tests
import { StatusBar } from '../src/tui/components/StatusBar.js';
import {
  SectionHeader,
  SystemSection,
  ProjectsSection,
  ActivitySection,
  McpClientsSection,
} from '../src/tui/components/DashboardPanel.js';
import type { Project, ActivityEvent, HealthResponse, ProjectStats } from '../src/ipc/client.js';
import type { SystemStats } from '../src/monitor/stats.js';

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

  it('returns yellow for 70%', () => {
    expect(getColorForPercent(70)).toBe(theme.resourceWarn);
  });

  it('returns yellow for exactly 80%', () => {
    expect(getColorForPercent(80)).toBe(theme.resourceWarn);
  });

  it('returns red for 90%', () => {
    expect(getColorForPercent(90)).toBe(theme.resourceCrit);
  });

  it('returns red for 100%', () => {
    expect(getColorForPercent(100)).toBe(theme.resourceCrit);
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

// ---------------------------------------------------------------------------
// Component Rendering Tests
// ---------------------------------------------------------------------------

describe('SectionHeader', () => {
  it('renders title with arrow prefix', () => {
    const { lastFrame } = render(<SectionHeader title="System" />);
    expect(lastFrame()).toContain('▸');
    expect(lastFrame()).toContain('System');
  });

  it('renders different titles', () => {
    const { lastFrame } = render(<SectionHeader title="Projects (5)" />);
    expect(lastFrame()).toContain('Projects (5)');
  });
});

describe('StatusBar', () => {
  it('renders in split mode with keyboard hints', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="split"
        activePanel="left"
        projectCount={3}
        cpuPercent={45}
        buildingCount={0}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('Tab');
    expect(output).toContain('/');
    expect(output).toContain('?');
    expect(output).toContain('Ctrl+C');
  });

  it('renders in single mode with project count and CPU percentage', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={3}
        cpuPercent={45}
        buildingCount={0}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('3 project');
    expect(output).toContain('45%');
  });

  it('shows building count when > 0', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={5}
        cpuPercent={30}
        buildingCount={2}
      />,
    );
    expect(lastFrame()).toContain('2 building');
  });

  it('does not show building indicator when 0', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={5}
        cpuPercent={30}
        buildingCount={0}
      />,
    );
    expect(lastFrame()).not.toContain('building');
  });

  it('shows dash for null CPU', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={1}
        cpuPercent={null}
        buildingCount={0}
      />,
    );
    expect(lastFrame()).toContain('—');
  });

  it('shows plural "projects" for multiple', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={3}
        cpuPercent={50}
        buildingCount={0}
      />,
    );
    expect(lastFrame()).toContain('projects');
  });

  it('shows singular "project" for one', () => {
    const { lastFrame } = render(
      <StatusBar
        panelMode="single"
        activePanel="left"
        projectCount={1}
        cpuPercent={50}
        buildingCount={0}
      />,
    );
    expect(lastFrame()).toContain('1 project');
    expect(lastFrame()).not.toContain('1 projects');
  });
});

describe('SystemSection', () => {
  it('shows "Loading..." spinner when loading=true and stats=null', () => {
    const { lastFrame } = render(<SystemSection stats={null} health={null} loading={true} />);
    expect(lastFrame()).toContain('Loading');
  });

  it('shows "Unavailable" when stats=null and loading=false', () => {
    const { lastFrame } = render(<SystemSection stats={null} health={null} loading={false} />);
    expect(lastFrame()).toContain('Unavailable');
  });

  it('renders CPU and memory stats', () => {
    const mockStats: SystemStats = {
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 2,
        loadAvg5m: 2,
        loadAvg15m: 2,
        usagePercent: 45,
      },
      memory: { totalMB: 8192, usedMB: 4096, freeMB: 4096, usagePercent: 50 },
      disk: { totalGB: 100, usedGB: 50, freeGB: 50, usagePercent: 50 },
    };
    const { lastFrame } = render(<SystemSection stats={mockStats} health={null} loading={false} />);
    const output = lastFrame();
    expect(output).toContain('CPU');
    expect(output).toContain('45%');
    expect(output).toContain('MEM');
  });

  it('renders disk percentage', () => {
    const mockStats: SystemStats = {
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 2,
        loadAvg5m: 2,
        loadAvg15m: 2,
        usagePercent: 45,
      },
      memory: { totalMB: 8192, usedMB: 4096, freeMB: 4096, usagePercent: 50 },
      disk: { totalGB: 100, usedGB: 50, freeGB: 50, usagePercent: 50 },
    };
    const { lastFrame } = render(<SystemSection stats={mockStats} health={null} loading={false} />);
    expect(lastFrame()).toContain('Disk');
    expect(lastFrame()).toContain('50%');
  });

  it('renders Docker container count from health', () => {
    const mockStats: SystemStats = {
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 2,
        loadAvg5m: 2,
        loadAvg15m: 2,
        usagePercent: 45,
      },
      memory: { totalMB: 8192, usedMB: 4096, freeMB: 4096, usagePercent: 50 },
      disk: { totalGB: 100, usedGB: 50, freeGB: 50, usagePercent: 50 },
    };
    const mockHealth: HealthResponse = {
      status: 'ok',
      version: '1.0.0',
      llmConfigured: true,
      timestamp: '2024-01-15T14:30:00Z',
      uptime: 3600,
      dockerContainers: 5,
    };
    const { lastFrame } = render(
      <SystemSection stats={mockStats} health={mockHealth} loading={false} />,
    );
    expect(lastFrame()).toContain('Docker');
    expect(lastFrame()).toContain('5');
    expect(lastFrame()).toContain('containers');
  });
});

describe('ProjectsSection', () => {
  it('shows "No projects yet" when empty', () => {
    const { lastFrame } = render(
      <ProjectsSection projects={[]} projectStats={new Map()} selectedIndex={0} focus={false} />,
    );
    expect(lastFrame()).toContain('No projects yet');
  });

  it('renders project list with correct status icons', () => {
    const projects: Project[] = [
      {
        id: '1',
        name: 'my-app',
        status: 'running',
        visibility: 'private',
        repoUrl: null,
        branch: null,
        port: 3000,
        url: 'http://localhost:3000',
        publicUrl: null,
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
      {
        id: '2',
        name: 'api-server',
        status: 'building',
        visibility: 'private',
        repoUrl: null,
        branch: null,
        port: 3001,
        url: 'http://localhost:3001',
        publicUrl: null,
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
    ];
    const { lastFrame } = render(
      <ProjectsSection
        projects={projects}
        projectStats={new Map()}
        selectedIndex={0}
        focus={false}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('my-app');
    expect(output).toContain('api-server');
    expect(output).toContain('●'); // running icon
    expect(output).toContain('◐'); // building icon
  });

  it('shows project count in header', () => {
    const projects: Project[] = [
      {
        id: '1',
        name: 'app1',
        status: 'running',
        visibility: 'private',
        repoUrl: null,
        branch: null,
        port: 3000,
        url: null,
        publicUrl: null,
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
      {
        id: '2',
        name: 'app2',
        status: 'stopped',
        visibility: 'private',
        repoUrl: null,
        branch: null,
        port: 3001,
        url: null,
        publicUrl: null,
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
    ];
    const { lastFrame } = render(
      <ProjectsSection
        projects={projects}
        projectStats={new Map()}
        selectedIndex={0}
        focus={false}
      />,
    );
    expect(lastFrame()).toContain('Projects (2)');
  });

  it('renders memory usage for running projects with stats', () => {
    const projects: Project[] = [
      {
        id: '1',
        name: 'my-app',
        status: 'running',
        visibility: 'private',
        repoUrl: null,
        branch: null,
        port: 3000,
        url: null,
        publicUrl: null,
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
    ];
    const stats: ProjectStats = {
      containerId: 'abc123',
      cpu: 10,
      memoryUsage: 256 * 1024 * 1024, // 256MB in bytes
      memoryLimit: 1024 * 1024 * 1024,
      memoryPercent: 25,
      networkRx: 1000,
      networkTx: 500,
      pids: 5,
    };
    const projectStats = new Map<string, ProjectStats>();
    projectStats.set('1', stats);
    const { lastFrame } = render(
      <ProjectsSection
        projects={projects}
        projectStats={projectStats}
        selectedIndex={0}
        focus={false}
      />,
    );
    expect(lastFrame()).toContain('256M');
  });

  it('renders domain/publicUrl when available', () => {
    const projects: Project[] = [
      {
        id: '1',
        name: 'my-app',
        status: 'running',
        visibility: 'public',
        repoUrl: null,
        branch: null,
        port: 3000,
        url: 'http://localhost:3000',
        publicUrl: 'https://my-app.example.com',
        createdAt: '2024-01-15T14:30:00Z',
        updatedAt: '2024-01-15T14:30:00Z',
      },
    ];
    const { lastFrame } = render(
      <ProjectsSection
        projects={projects}
        projectStats={new Map()}
        selectedIndex={0}
        focus={false}
      />,
    );
    expect(lastFrame()).toContain('my-app.example.com');
  });
});

describe('ActivitySection', () => {
  it('shows "No recent activity" when empty', () => {
    const { lastFrame } = render(<ActivitySection events={[]} />);
    expect(lastFrame()).toContain('No recent activity');
  });

  it('renders events with timestamps', () => {
    const events: ActivityEvent[] = [
      {
        type: 'info',
        message: 'Deployment started',
        timestamp: '2024-01-15T14:30:00Z',
        user: 'john',
      },
    ];
    const { lastFrame } = render(<ActivitySection events={events} />);
    const output = lastFrame();
    // Timestamp format is HH:MM
    expect(output).toMatch(/\d{2}:\d{2}/);
  });

  it('renders event messages', () => {
    const events: ActivityEvent[] = [
      {
        type: 'info',
        message: 'Build completed successfully',
        timestamp: '2024-01-15T14:30:00Z',
        user: 'alice',
      },
    ];
    const { lastFrame } = render(<ActivitySection events={events} />);
    expect(lastFrame()).toContain('Build completed');
  });

  it('renders user names', () => {
    const events: ActivityEvent[] = [
      {
        type: 'info',
        message: 'Test message',
        timestamp: '2024-01-15T14:30:00Z',
        user: 'testuser',
      },
    ];
    const { lastFrame } = render(<ActivitySection events={events} />);
    expect(lastFrame()).toContain('testuser');
  });

  it('limits display to 10 events', () => {
    const events: ActivityEvent[] = Array.from({ length: 15 }, (_, i) => ({
      type: 'info',
      message: `Event ${String(i)}`,
      timestamp: '2024-01-15T14:30:00Z',
      user: 'user',
    }));
    const { lastFrame } = render(<ActivitySection events={events} />);
    // Should show Event 0-9 but not Event 14 (the 15th event)
    expect(lastFrame()).toContain('Event 0');
    expect(lastFrame()).toContain('Event 9');
    expect(lastFrame()).not.toContain('Event 14');
  });

  it('shows success icon for successful events', () => {
    const events: ActivityEvent[] = [
      {
        type: 'success',
        message: 'Deployment successful',
        timestamp: '2024-01-15T14:30:00Z',
        user: 'user',
      },
    ];
    const { lastFrame } = render(<ActivitySection events={events} />);
    expect(lastFrame()).toContain('✅');
  });

  it('shows error icon for error events', () => {
    const events: ActivityEvent[] = [
      {
        type: 'error',
        message: 'Deployment error',
        timestamp: '2024-01-15T14:30:00Z',
        user: 'user',
      },
    ];
    const { lastFrame } = render(<ActivitySection events={events} />);
    expect(lastFrame()).toContain('❌');
  });
});

describe('McpClientsSection', () => {
  it('shows "MCP disabled" when not enabled', () => {
    const { lastFrame } = render(<McpClientsSection enabled={false} />);
    expect(lastFrame()).toContain('MCP disabled');
  });

  it('shows "MCP server active" when enabled', () => {
    const { lastFrame } = render(<McpClientsSection enabled={true} />);
    expect(lastFrame()).toContain('MCP server active');
  });

  it('shows install command hint when enabled', () => {
    const { lastFrame } = render(<McpClientsSection enabled={true} />);
    expect(lastFrame()).toContain('openlander mcp install');
  });

  it('shows "No clients connected" when enabled', () => {
    const { lastFrame } = render(<McpClientsSection enabled={true} />);
    expect(lastFrame()).toContain('No clients connected');
  });
});
