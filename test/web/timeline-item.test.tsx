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

vi.mock('../../web/src/components/timeline/ErrorAnalysisCard.js', () => ({
  ErrorAnalysisCard: () => 'ErrorAnalysisCard',
}));

vi.mock('../../web/src/components/timeline/FixProposalCard.js', () => ({
  FixProposalCard: () => 'FixProposalCard',
}));

vi.mock('../../web/src/components/timeline/ComposeErrorCard.js', () => ({
  ComposeErrorCard: () => 'ComposeErrorCard',
}));

// Helper to find text in the React element tree
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

  it('routes insight and dockerfile_fixed items to dedicated cards', () => {
    const insightItem: TimelineItem = {
      id: '3',
      type: 'insight',
      timestamp: new Date().toISOString(),
      title: 'Insight',
      percent: 50,
    };
    const dockerfileFixedItem: TimelineItem = {
      id: '4',
      type: 'dockerfile_fixed',
      timestamp: new Date().toISOString(),
      title: 'Fixed',
      percent: 100,
    };

    const insightTree = TimelineItemCard({ item: insightItem });
    const dockerfileTree = TimelineItemCard({ item: dockerfileFixedItem });

    expect(findTextInTree(insightTree, 'InsightCard')).toBe(true);
    expect(findTextInTree(dockerfileTree, 'DockerfileFixedCard')).toBe(true);
  });

  it('routes agent_tool_result error-analysis variant to ErrorAnalysisCard', () => {
    const item: TimelineItem = {
      id: '5',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Error analysis result',
      percent: -1,
      toolName: 'error_analysis',
      toolResult: {},
    };

    const tree = TimelineItemCard({ item });
    expect(findTextInTree(tree, 'ErrorAnalysisCard')).toBe(true);
  });

  it('routes non analysis agent_tool_result to ToolResultCard', () => {
    const item: TimelineItem = {
      id: '6',
      type: 'agent_tool_result',
      timestamp: new Date().toISOString(),
      title: 'Result',
      percent: -1,
      toolName: 'deploy_project',
      toolResult: {},
    };

    const tree = TimelineItemCard({ item });
    expect(findTextInTree(tree, 'ToolResultCard')).toBe(true);
  });

  it('routes compose and fix-proposal questions by metadata', () => {
    const composeQuestion: TimelineItem = {
      id: '7',
      type: 'question',
      timestamp: new Date().toISOString(),
      title: 'Compose?',
      percent: -1,
      questionId: 'q1',
      questions: [
        {
          question: 'Fix compose?',
          options: [{ label: 'Apply' }],
          metadata: { fixType: 'compose' },
        },
      ],
    };

    const proposalQuestion: TimelineItem = {
      id: '8',
      type: 'question',
      timestamp: new Date().toISOString(),
      title: 'Dockerfile?',
      percent: -1,
      questionId: 'q2',
      questions: [
        {
          question: 'Fix dockerfile?',
          options: [{ label: 'Apply' }],
          metadata: { fixType: 'dockerfile' },
        },
      ],
    };

    const composeTree = TimelineItemCard({ item: composeQuestion });
    const proposalTree = TimelineItemCard({ item: proposalQuestion });

    expect(findTextInTree(composeTree, 'ComposeErrorCard')).toBe(true);
    expect(findTextInTree(proposalTree, 'FixProposalCard')).toBe(true);
  });

  it('routes plain questions to InputRequestCard', () => {
    const plainQuestion: TimelineItem = {
      id: '9',
      type: 'question',
      timestamp: new Date().toISOString(),
      title: 'Need input',
      percent: -1,
      questionId: 'q3',
      questions: [
        {
          question: 'Choose one',
          options: [{ label: 'A' }],
        },
      ],
    };

    const tree = TimelineItemCard({ item: plainQuestion });
    expect(findTextInTree(tree, 'InputRequestCard')).toBe(true);
  });

  it('renders success link without protocol and error build log tail', () => {
    const successItem: TimelineItem = {
      id: '10',
      type: 'success',
      timestamp: new Date().toISOString(),
      title: 'Deploy done',
      percent: 100,
      url: 'https://demo.example.com',
    };
    const errorItem: TimelineItem = {
      id: '11',
      type: 'error',
      timestamp: new Date().toISOString(),
      title: 'Build failed',
      percent: -1,
      detail: `${'x'.repeat(2050)}TAIL`,
    };

    const successTree = TimelineItemCard({ item: successItem });
    const errorTree = TimelineItemCard({ item: errorItem });

    expect(findTextInTree(successTree, 'demo.example.com')).toBe(true);
    expect(findTextInTree(successTree, 'https://demo.example.com')).toBe(false);
    expect(findTextInTree(errorTree, 'Build log ▾')).toBe(true);
    expect(findTextInTree(errorTree, 'TAIL')).toBe(true);
  });

  it('renders agent_tool_call title prefix and no args section for undefined args', () => {
    const item: TimelineItem = {
      id: '12',
      type: 'agent_tool_call',
      timestamp: new Date().toISOString(),
      title: 'Tool call',
      percent: -1,
      toolName: 'deploy_project',
    };

    const tree = TimelineItemCard({ item });
    expect(findTextInTree(tree, '▸ deploy_project 실행')).toBe(true);
    expect(findTextInTree(tree, 'Arguments ▾')).toBe(false);
  });

  it('keeps raw markdown title text for non-agent and agent message items', () => {
    const normalItem: TimelineItem = {
      id: '13',
      type: 'progress',
      timestamp: new Date().toISOString(),
      title: '**Title** with `code` and [link](https://example.com)\n- bullet',
      percent: -1,
    };
    const agentMessageItem: TimelineItem = {
      id: '14',
      type: 'agent_message',
      timestamp: new Date().toISOString(),
      title: '**Raw agent message**',
      percent: -1,
    };

    const normalTree = TimelineItemCard({ item: normalItem });
    const agentTree = TimelineItemCard({ item: agentMessageItem });

    expect(findTextInTree(normalTree, '**Title**')).toBe(true);
    expect(findTextInTree(normalTree, '[link](https://example.com)')).toBe(true);
    expect(findTextInTree(agentTree, '**Raw agent message**')).toBe(true);
  });
});
