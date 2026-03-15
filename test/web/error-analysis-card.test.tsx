import { describe, it, expect, vi } from 'vitest';
import type { TimelineItem } from '../../web/src/lib/event-types.js';
import { ErrorAnalysisCard } from '../../web/src/components/timeline/ErrorAnalysisCard.js';

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
}));

function findTextInTree(node: any, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => findTextInTree(child, text));
  }
  if (node && typeof node === 'object' && node.props) {
    if (node.props.children) {
      return findTextInTree(node.props.children, text);
    }
  }
  return false;
}

describe('ErrorAnalysisCard', () => {
  it('renders null if toolResult is not an ErrorAnalysisResult', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Error Analysis',
      percent: -1,
      toolName: 'error-analysis',
      toolResult: { invalid: 'data' },
    };

    const tree = ErrorAnalysisCard({ item });
    expect(tree).toBeNull();
  });

  it('renders error analysis details correctly', () => {
    const item: TimelineItem = {
      id: '2',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Error Analysis',
      percent: -1,
      toolName: 'error-analysis',
      toolResult: {
        summary: 'Build failed due to missing dependency',
        rootCause: 'The package "express" is not installed',
        suggestedFixes: [
          {
            description: 'Run npm install express',
            location: 'package.json',
            confidence: 'high',
          },
        ],
      },
    };

    const tree = ErrorAnalysisCard({ item });

    expect(findTextInTree(tree, 'timeline.errorAnalysis.title')).toBe(true);
    expect(findTextInTree(tree, 'Build failed due to missing dependency')).toBe(true);
    expect(findTextInTree(tree, 'The package "express" is not installed')).toBe(true);
    expect(findTextInTree(tree, 'Run npm install express')).toBe(true);
    expect(findTextInTree(tree, 'package.json')).toBe(true);
    expect(findTextInTree(tree, 'high')).toBe(true);
  });
});
