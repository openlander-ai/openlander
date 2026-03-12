import { beforeAll, describe, it, expect, vi } from 'vitest';
import type { TimelineItem } from '../../web/src/lib/event-types.js';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
let TimelineItemCard: typeof import('../../web/src/components/timeline/TimelineItem.js').TimelineItemCard;

vi.mock('@/lib/utils', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/lib/time', () => ({
  formatTime: (ts: string) => ts,
}));

vi.mock('lucide-react', () => ({
  ExternalLink: () => 'ExternalLink',
  AlertCircle: () => 'AlertCircle',
  CheckCircle2: () => 'CheckCircle2',
  Wrench: () => 'Wrench',
  MessageCircle: () => 'MessageCircle',
  Activity: () => 'Activity',
}));

vi.mock('../../web/src/components/timeline/InputRequestCard.js', () => ({
  InputRequestCard: () => 'InputRequestCard',
}));

vi.mock('../../web/src/components/timeline/InsightCard.js', () => ({
  InsightCard: () => 'InsightCard',
}));

vi.mock('../../web/src/components/timeline/DockerfileFixedCard.js', () => ({
  DockerfileFixedCard: () => 'DockerfileFixedCard',
}));

vi.mock('../../web/src/components/timeline/ToolResultCard.js', () => ({
  ToolResultCard: () => 'ToolResultCard',
}));

// Helper to find text in the React element tree
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

const describeTimeline = isBunRuntime ? describe.skip : describe;

describeTimeline('TimelineItemCard', () => {
  beforeAll(async () => {
    ({ TimelineItemCard } = await import('../../web/src/components/timeline/TimelineItem.js'));
  });

  it('renders tool call arguments in a collapsible details block', () => {
    const item: TimelineItem = {
      id: '1',
      type: 'agent_tool_call',
      timestamp: new Date().toISOString(),
      title: 'Calling my_tool',
      percent: -1,
      toolName: 'my_tool',
      toolArguments: {
        arg1: 'value1',
        secret_key: '[redacted]',
      },
    };

    const tree = TimelineItemCard({ item });

    // Should render the summary
    expect(findTextInTree(tree, 'Arguments ▾')).toBe(true);

    // Should render the arguments JSON
    expect(findTextInTree(tree, 'value1')).toBe(true);
    expect(findTextInTree(tree, '[redacted]')).toBe(true);
  });

  it('does not render arguments block if toolArguments is empty', () => {
    const item: TimelineItem = {
      id: '2',
      type: 'agent_tool_call',
      timestamp: new Date().toISOString(),
      title: 'Calling my_tool',
      percent: -1,
      toolName: 'my_tool',
      toolArguments: {},
    };

    const tree = TimelineItemCard({ item });

    expect(findTextInTree(tree, 'Arguments ▾')).toBe(false);
  });
});
