import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { TimelineItem } from '../../web/src/lib/event-types.js';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
let TimelineItemCard: typeof import('../../web/src/components/timeline/TimelineItem.js').TimelineItemCard;

interface HookDispatcher {
  useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((value: T) => T)) => void];
  useEffect(effect: () => void | (() => void)): void;
  useMemo<T>(factory: () => T): T;
}

interface ReactClientInternals {
  H: HookDispatcher | null;
}

interface ReactModuleLike {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
}

let ReactModule: ReactModuleLike;
let hookIndex = 0;
const hookSlots: unknown[] = [];

const hookDispatcher: HookDispatcher = {
  useState<T>(initial: T | (() => T)) {
    const slotIndex = hookIndex;
    hookIndex += 1;

    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = initial instanceof Function ? initial() : initial;
    }

    const setState = (next: T | ((value: T) => T)) => {
      const currentValue = hookSlots[slotIndex] as T;
      hookSlots[slotIndex] = next instanceof Function ? next(currentValue) : next;
    };

    const state = hookSlots[slotIndex] as T;
    return [state, setState] as const;
  },
  useEffect(effect) {
    effect();
  },
  useMemo(factory) {
    return factory();
  },
};

vi.mock('@/lib/utils', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/lib/time', () => ({
  formatTime: (ts: string) => ts,
}));

// Mock useLanguage to return a simple translation function
const mockTranslations: Record<string, string> = {
  'timeline.toolExecuting': 'Executing',
  'timeline.analyzing': 'Analyzing...',
  'timeline.buildFailed': 'Build failed',
  'timeline.detailedCauseExplanation': 'Detailed cause explanation ▾',
  'timeline.recovery.complete': 'AI recovery complete',
  'timeline.recovery.inProgress': 'AI recovery in progress...',
  'timeline.recovery.options': 'AI recovery options',
};

vi.mock('@/i18n/context.js', () => ({
  useLanguage: () => ({
    t: (key: string) => mockTranslations[key] || key,
  }),
}));

vi.mock('../../web/src/components/timeline/InsightCard.js', () => ({
  InsightCard: ({ item }: { item: { title: string } }) => item.title,
}));

vi.mock('../../web/src/components/timeline/DockerfileFixedCard.js', () => ({
  DockerfileFixedCard: ({ item }: { item: { title: string } }) => item.title,
}));

vi.mock('../../web/src/components/timeline/ErrorAnalysisCard.js', () => ({
  ErrorAnalysisCard: () => 'timeline.errorAnalysis.title',
}));

vi.mock('../../web/src/components/timeline/ToolResultCard.js', () => ({
  ToolResultCard: ({ item }: { item: { title: string } }) => item.title,
}));

vi.mock('../../web/src/components/timeline/ComposeErrorCard.js', () => ({
  ComposeErrorCard: ({ questions }: { questions: Array<{ question: string }> }) =>
    questions[0]?.question,
}));

vi.mock('../../web/src/components/timeline/FixProposalCard.js', () => ({
  FixProposalCard: ({ questions }: { questions: Array<{ question: string }> }) =>
    questions[0]?.question,
}));

vi.mock('../../web/src/components/timeline/InputRequestCard.js', () => ({
  InputRequestCard: ({ questions }: { questions: Array<{ question: string }> }) =>
    questions[0]?.question,
}));

vi.mock('../../web/src/components/timeline/RecoveryCard.js', () => ({
  RecoveryCard: ({ item }: { item: { title: string } }) => item.title,
}));

vi.mock('lucide-react', () => ({
  ExternalLink: () => 'ExternalLink',
  AlertCircle: () => 'AlertCircle',
  CheckCircle2: () => 'CheckCircle2',
  Wrench: () => 'Wrench',
  MessageCircle: () => 'MessageCircle',
  Activity: () => 'Activity',
  Info: () => 'Info',
  AlertTriangle: () => 'AlertTriangle',
  Loader2: () => 'Loader2',
  Sparkles: () => 'Sparkles',
  Search: () => 'Search',
  FileCode2: () => 'FileCode2',
  Check: () => 'Check',
  X: () => 'X',
  MessageCircleQuestion: () => 'MessageCircleQuestion',
  Send: () => 'Send',
  SkipForward: () => 'SkipForward',
  Terminal: () => 'Terminal',
  ChevronUp: () => 'ChevronUp',
  ChevronDown: () => 'ChevronDown',
  FileText: () => 'FileText',
  GitPullRequest: () => 'GitPullRequest',
  Trash2: () => 'Trash2',
  Clock: () => 'Clock',
  Copy: () => 'Copy',
  Brain: () => 'Brain',
  ArrowDown: () => 'ArrowDown',
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

function renderTimelineItem(item: TimelineItem) {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return TimelineItemCard({ item });
  } finally {
    internals.H = previousDispatcher;
  }
}

const describeTimeline = isBunRuntime ? describe.skip : describe;

describeTimeline('TimelineItemCard', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ TimelineItemCard } = await import('../../web/src/components/timeline/TimelineItem.js'));
  });

  beforeEach(() => {
    hookSlots.length = 0;
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

    const tree = renderTimelineItem(item);

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

    const tree = renderTimelineItem(item);

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

    const insightTree = renderTimelineItem(insightItem);
    const dockerfileTree = renderTimelineItem(dockerfileFixedItem);

    expect(findTextInTree(insightTree, 'Insight')).toBe(true);
    expect(findTextInTree(dockerfileTree, 'Fixed')).toBe(true);
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

    const tree = renderTimelineItem(item);
    expect(findTextInTree(tree, 'Result')).toBe(true);
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

    const composeTree = renderTimelineItem(composeQuestion);
    const proposalTree = renderTimelineItem(proposalQuestion);

    expect(findTextInTree(composeTree, 'Fix compose?')).toBe(true);
    expect(findTextInTree(proposalTree, 'Fix dockerfile?')).toBe(true);
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

    const tree = renderTimelineItem(plainQuestion);
    expect(findTextInTree(tree, 'Choose one')).toBe(true);
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

    const successTree = renderTimelineItem(successItem);
    const errorTree = renderTimelineItem(errorItem);

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

    const tree = renderTimelineItem(item);
    expect(findTextInTree(tree, '▸ deploy_project Executing')).toBe(true);
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

    const normalTree = renderTimelineItem(normalItem);
    const agentTree = renderTimelineItem(agentMessageItem);

    expect(findTextInTree(normalTree, '**Title**')).toBe(true);
    expect(findTextInTree(normalTree, '[link](https://example.com)')).toBe(true);
    expect(findTextInTree(agentTree, '**Raw agent message**')).toBe(true);
  });
});
