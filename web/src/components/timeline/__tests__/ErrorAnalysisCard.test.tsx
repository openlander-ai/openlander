import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => {
  type MockElement = {
    type: unknown;
    props: Record<string, unknown> & { children: unknown[] };
  };
  return {
    Fragment: ({ children }: { children?: unknown }) => children,
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): MockElement => ({
      type,
      props: { ...props, children },
    }),
  };
});

import { ErrorAnalysisCard } from '../ErrorAnalysisCard';
import type { TimelineItem } from '@/lib/event-types';

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/lib/time', () => ({
  formatTime: () => '12:00 PM',
}));

vi.mock('lucide-react', () => ({
  Search: () => 'Search',
  CheckCircle2: () => 'CheckCircle2',
}));

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }
  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    if (typeof element.type === 'function') {
      return getTextContent(element.type(element.props));
    }
    if (element.props?.children) {
      return getTextContent(element.props.children);
    }
    if (typeof element.type === 'symbol' && element.props?.children) {
      return getTextContent(element.props.children);
    }
  }
  return '';
}

function findTextInTree(node: unknown, text: string): boolean {
  return getTextContent(node).includes(text);
}

describe('ErrorAnalysisCard', () => {
  it('renders nothing if not an error analysis result', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'other_tool result',
      percent: -1,
      toolName: 'other_tool',
      toolResult: {},
    };
    const tree = ErrorAnalysisCard({ item });
    expect(tree).toBeNull();
  });

  it('renders error analysis details', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'debug_build_error result',
      percent: -1,
      toolName: 'debug_build_error',
      toolResult: {
        summary: 'Build failed due to missing dependency',
        rootCause: 'Cannot find module "express"',
        suggestedFixes: [
          {
            description: 'Install express',
            confidence: 'high',
            location: 'package.json',
          },
        ],
      },
    };

    const tree = ErrorAnalysisCard({ item });

    expect(findTextInTree(tree, 'timeline.errorAnalysis.title')).toBe(true);
    expect(findTextInTree(tree, 'Build failed due to missing dependency')).toBe(true);
    expect(findTextInTree(tree, 'Cannot find module "express"')).toBe(true);
    expect(findTextInTree(tree, 'Install express')).toBe(true);
    expect(findTextInTree(tree, 'package.json')).toBe(true);
  });

  it('renders raw log/detail area when item.detail exists', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'debug_build_error result',
      percent: -1,
      toolName: 'debug_build_error',
      detail: 'Raw error log output here',
      toolResult: {
        summary: 'Build failed',
        rootCause: 'Error',
        suggestedFixes: [],
      },
    };

    const tree = ErrorAnalysisCard({ item });

    expect(findTextInTree(tree, 'timeline.errorAnalysis.viewDetails')).toBe(true);
    expect(findTextInTree(tree, 'Raw error log output here')).toBe(true);
  });
});
