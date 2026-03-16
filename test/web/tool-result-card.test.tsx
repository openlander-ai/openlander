import { describe, it, expect, vi } from 'vitest';
import type { TimelineItem } from '../../web/src/lib/event-types.js';
import { ToolResultCard } from '../../web/src/components/timeline/ToolResultCard.js';

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/lib/time', () => ({
  formatTime: (ts: string) => ts,
}));

vi.mock('lucide-react', () => ({
  Search: () => 'Search',
  CheckCircle2: () => 'CheckCircle2',
  LayoutList: () => 'LayoutList',
  ScrollText: () => 'ScrollText',
  Activity: () => 'Activity',
  KeyRound: () => 'KeyRound',
  Wrench: () => 'Wrench',
  ExternalLink: () => 'ExternalLink',
  RotateCcw: () => 'RotateCcw',
  Layers: () => 'Layers',
}));

function findTextInTree(node: any, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => findTextInTree(child, text));
  }
  if (node && typeof node === 'object') {
    if (typeof node.type === 'function') {
      return findTextInTree(node.type(node.props), text);
    }
    if (node.props && node.props.children) {
      return findTextInTree(node.props.children, text);
    }
  }
  return false;
}

describe('ToolResultCard', () => {
  it('renders debug_build_error using ErrorAnalysisCard', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Error Analysis',
      percent: -1,
      toolName: 'debug_build_error',
      toolResult: {
        summary: 'Build failed due to missing dependency',
        rootCause: 'The package "express" is not installed',
        suggestedFixes: [],
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'timeline.errorAnalysis.title')).toBe(true);
    expect(findTextInTree(tree, 'Build failed due to missing dependency')).toBe(true);
  });

  it('renders debug_build_error using FallbackResult when data is not ErrorAnalysisResult', () => {
    const item: TimelineItem = {
      id: '1b',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Error Analysis',
      percent: -1,
      toolName: 'debug_build_error',
      toolResult: {
        someOtherData: 'not an error analysis result',
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'View result ▾')).toBe(true);
    expect(findTextInTree(tree, 'not an error analysis result')).toBe(true);
  });

  it('renders deploy_compose with compact structured view', () => {
    const item: TimelineItem = {
      id: '2',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Deploy Compose',
      percent: -1,
      toolName: 'deploy_compose',
      toolResult: {
        success: true,
        parentName: 'my-compose-app',
        services: [
          { name: 'web', status: 'running', ports: ['8080'] },
          { name: 'db', status: 'running', ports: [] },
        ],
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'my-compose-app')).toBe(true);
    expect(findTextInTree(tree, 'web')).toBe(true);
    expect(findTextInTree(tree, '8080')).toBe(true);
    expect(findTextInTree(tree, 'db')).toBe(true);
    // Should not render FallbackResult JSON
    expect(findTextInTree(tree, 'View result ▾')).toBe(false);
  });

  it('renders rollback_project with compact structured view', () => {
    const item: TimelineItem = {
      id: '3',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Rollback Project',
      percent: -1,
      toolName: 'rollback_project',
      toolResult: {
        success: true,
        projectName: 'my-app',
        commitSha: 'abcdef123456',
        url: 'https://my-app.example.com',
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'my-app')).toBe(true);
    expect(findTextInTree(tree, 'abcdef1')).toBe(true);
    expect(findTextInTree(tree, 'my-app.example.com')).toBe(true);
    // Should not render FallbackResult JSON
    expect(findTextInTree(tree, 'View result ▾')).toBe(false);
  });

  it('renders fix_dockerfile with compact structured view', () => {
    const item: TimelineItem = {
      id: '4',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Fix Dockerfile',
      percent: -1,
      toolName: 'fix_dockerfile',
      toolResult: {
        explanation: 'Added missing nodejs package',
        changes: ['RUN apt-get install -y nodejs'],
        dockerfileContent: 'FROM ubuntu\nRUN apt-get install -y nodejs',
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'Added missing nodejs package')).toBe(true);
    expect(findTextInTree(tree, 'RUN apt-get install -y nodejs')).toBe(true);
    expect(findTextInTree(tree, 'View Dockerfile ▾')).toBe(true);
    // Should not render FallbackResult JSON
    expect(findTextInTree(tree, 'View result ▾')).toBe(false);
  });

  it('renders deploy_project details with status, url and port', () => {
    const item: TimelineItem = {
      id: '5',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Deploy Project',
      percent: -1,
      toolName: 'deploy_project',
      toolResult: {
        projectName: 'demo-app',
        status: 'running',
        url: 'https://demo.example.com',
        port: 10114,
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'demo-app')).toBe(true);
    expect(findTextInTree(tree, 'running')).toBe(true);
    expect(findTextInTree(tree, 'demo.example.com')).toBe(true);
    expect(findTextInTree(tree, 'Port:')).toBe(true);
    expect(findTextInTree(tree, '10114')).toBe(true);
  });

  it('renders list_projects table with remaining-count summary', () => {
    const item: TimelineItem = {
      id: '6',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'List Projects',
      percent: -1,
      toolName: 'list_projects',
      toolResult: [
        { name: 'a', status: 'running', url: 'https://a.example.com' },
        { projectName: 'b', status: 'stopped' },
        { name: 'c', status: 'running' },
        { name: 'd', status: 'error' },
        { name: 'e' },
        { name: 'f' },
      ],
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'a')).toBe(true);
    expect(findTextInTree(tree, 'b')).toBe(true);
    expect(findTextInTree(tree, 'Link')).toBe(true);
    expect(findTextInTree(tree, 'more projects')).toBe(true);
  });

  it('falls back to masked JSON for unknown tool results', () => {
    const item: TimelineItem = {
      id: '7',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Unknown Tool',
      percent: -1,
      toolName: 'mystery_tool',
      toolResult: {
        token: 'abc123',
        env_vars: { API_KEY: 'secret', PASSWORD: 'pw' },
        nested: [{ passwordHint: 'hidden' }],
        envvars: 'inline',
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'View result ▾')).toBe(true);
    expect(findTextInTree(tree, '[redacted]')).toBe(true);
    expect(findTextInTree(tree, '"API_KEY": "***"')).toBe(true);
    expect(findTextInTree(tree, '"envvars": "***"')).toBe(true);
  });

  it('renders get_logs string payload trimmed to latest 500 chars', () => {
    const longLogs = `START-${'x'.repeat(600)}-END`;
    const item: TimelineItem = {
      id: '8',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Logs',
      percent: -1,
      toolName: 'get_logs',
      toolResult: longLogs,
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'View logs ▾')).toBe(true);
    expect(findTextInTree(tree, 'START-')).toBe(false);
    expect(findTextInTree(tree, '-END')).toBe(true);
  });

  it('renders get_system_stats from percent aliases and set_env_vars fallback keys', () => {
    const statsItem: TimelineItem = {
      id: '9',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Stats',
      percent: -1,
      toolName: 'get_system_stats',
      toolResult: {
        cpuPercent: 12,
        memoryPercent: 34,
        diskPercent: 56,
      },
    };

    const envItem: TimelineItem = {
      id: '10',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Set Env',
      percent: -1,
      toolName: 'set_env_vars',
      toolResult: {
        API_KEY: '1',
        DB_PASSWORD: '2',
      },
    };

    const statsTree = ToolResultCard({ item: statsItem });
    const envTree = ToolResultCard({ item: envItem });
    expect(findTextInTree(statsTree, 'CPU')).toBe(true);
    expect(findTextInTree(statsTree, '12')).toBe(true);
    expect(findTextInTree(envTree, 'Updated keys:')).toBe(true);
    expect(findTextInTree(envTree, 'API_KEY')).toBe(true);
    expect(findTextInTree(envTree, '***')).toBe(true);
  });

  it('renders tool errors without structured success renderer output', () => {
    const item: TimelineItem = {
      id: '11',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Deploy Failed',
      percent: -1,
      toolName: 'deploy_project',
      toolSuccess: false,
      toolError: 'Build failed at step 3',
      toolResult: {
        projectName: 'should-not-render',
      },
    };

    const tree = ToolResultCard({ item });
    expect(findTextInTree(tree, 'Build failed at step 3')).toBe(true);
    expect(findTextInTree(tree, 'should-not-render')).toBe(false);
  });
});
