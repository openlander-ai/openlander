import { describe, it, expect, vi } from 'vitest';
import type { BuildStreamEvent } from '../../web/src/lib/event-types.js';
import type { ChatStreamEvent } from '../../web/src/types/index.js';
import { toTimelineItem } from '../../web/src/lib/event-types.js';
import {
  buildEventToAssistantItem,
  chatEventToAssistantItem,
} from '../../web/src/hooks/assistant-event-mapper.js';
import { TimelineItemCard } from '../../web/src/components/timeline/TimelineItem.js';
import { FixProposalCard } from '../../web/src/components/timeline/FixProposalCard.js';
import { ComposeErrorCard } from '../../web/src/components/timeline/ComposeErrorCard.js';

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
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
  MessageCircleQuestion: () => 'MessageCircleQuestion',
  Activity: () => 'Activity',
  Info: () => 'Info',
  AlertTriangle: () => 'AlertTriangle',
  Loader2: () => 'Loader2',
  Search: () => 'Search',
  Check: () => 'Check',
  X: () => 'X',
  FileCode2: () => 'FileCode2',
  Send: () => 'Send',
  SkipForward: () => 'SkipForward',
  LayoutList: () => 'LayoutList',
  ScrollText: () => 'ScrollText',
  KeyRound: () => 'KeyRound',
  RotateCcw: () => 'RotateCcw',
  Layers: () => 'Layers',
}));

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => getTextContent(child)).join('');
  }

  if (node && typeof node === 'object') {
    const element = node as {
      type?: unknown;
      props?: { children?: unknown };
    };

    if (typeof element.type === 'function') {
      return getTextContent(element.type(element.props));
    }

    if (element.props?.children) {
      return getTextContent(element.props.children);
    }
  }

  return '';
}

describe('agent UX integration flow', () => {
  it('proves compose failure to error analysis timeline rendering path', () => {
    const flowEvents: BuildStreamEvent[] = [
      {
        type: 'agent_tool_result',
        message: 'deploy_compose failed',
        projectId: 'p1',
        timestamp: '2026-03-15T00:00:01.000Z',
        toolName: 'deploy_compose',
        toolSuccess: false,
        toolError: 'env_file ./backend/.env not found',
        toolResult: { error: 'BUILD_FAILED' },
      },
      {
        type: 'agent_tool_result',
        message: 'Analyzed compose failure',
        projectId: 'p1',
        timestamp: '2026-03-15T00:00:02.000Z',
        toolName: 'debug_build_error',
        toolSuccess: true,
        toolResult: {
          summary: 'Missing env_file in compose config',
          rootCause: 'docker-compose.yml references ./backend/.env but file is absent',
          suggestedFixes: [
            {
              description: 'Use root-level .env and selective injection',
              confidence: 'high',
            },
          ],
        },
      },
    ];

    const timelineItems = flowEvents.map((event) => toTimelineItem(event));
    const deployFailure = timelineItems[0];
    const analysis = timelineItems[1];

    expect(deployFailure.toolName).toBe('deploy_compose');
    expect(deployFailure.toolSuccess).toBe(false);
    expect(analysis.toolName).toBe('debug_build_error');

    const rendered = TimelineItemCard({ item: analysis });
    const content = getTextContent(rendered);

    expect(content).toContain('timeline.errorAnalysis.title');
    expect(content).toContain('Missing env_file in compose config');
    expect(content).toContain('docker-compose.yml references ./backend/.env but file is absent');
    expect(content).not.toContain('View result ▾');

    const assistantFromBuild = buildEventToAssistantItem(flowEvents[1]);
    expect(assistantFromBuild?.type).toBe('tool_result');
    expect(assistantFromBuild?.toolName).toBe('debug_build_error');
  });

  it('routes question metadata to compose and fix-proposal timeline renderers', () => {
    const composeQuestion = toTimelineItem({
      type: 'question_pending',
      message: 'Choose compose env strategy',
      projectId: 'p1',
      timestamp: '2026-03-15T00:00:03.000Z',
      questionId: 'q-compose',
      questions: [
        {
          question: 'How should we fix env_file?',
          options: [{ label: 'Root .env' }, { label: 'Per-service env files' }],
          metadata: {
            fixType: 'compose',
            errorType: 'env_file_missing',
            patterns: [
              {
                id: 'root-env',
                name: 'Root .env',
                description: 'Use one root-level env file',
                codeSnippet: 'env_file: .env',
                recommended: true,
              },
            ],
          },
        },
      ],
    });

    const fixProposalQuestion = toTimelineItem({
      type: 'question_pending',
      message: 'Apply this compose fix?',
      projectId: 'p1',
      timestamp: '2026-03-15T00:00:04.000Z',
      questionId: 'q-fix',
      questions: [
        {
          question: 'Approve compose update and redeploy?',
          options: [{ label: 'Apply this fix' }, { label: 'Show me other options' }],
          metadata: {
            fixType: 'dockerfile',
            filePath: 'docker-compose.yml',
            before: 'env_file: ./backend/.env',
            after: 'env_file: ./.env',
            changes: ['Updated env_file path to project root'],
          },
        },
      ],
    });

    const composeRendered = TimelineItemCard({ item: composeQuestion });
    const fixRendered = TimelineItemCard({ item: fixProposalQuestion });

    expect(composeRendered.type).toBe(ComposeErrorCard);
    expect(fixRendered.type).toBe(FixProposalCard);
  });

  it('proves assistant chat-event path keeps structured tool and question context', () => {
    const toolCallEvent: ChatStreamEvent = {
      type: 'tool_call',
      toolName: 'debug_build_error',
      arguments: { projectId: 'p1' },
    };

    const toolResultEvent: ChatStreamEvent = {
      type: 'tool_result',
      toolName: 'debug_build_error',
      success: true,
      result: {
        summary: 'Missing env_file in compose config',
        rootCause: 'env_file path points to a missing file',
        suggestedFixes: [{ description: 'Use root .env', confidence: 'high' }],
      },
    };

    const questionEvent: ChatStreamEvent = {
      type: 'question',
      request: {
        id: 'q-chat-fix',
        questions: [
          {
            question: 'Apply proposed compose fix?',
            options: [{ label: 'Apply this fix' }, { label: 'Show me other options' }],
          },
        ],
      },
    };

    const questionWithMetadata = questionEvent.request.questions[0] as Record<string, unknown>;
    questionWithMetadata.metadata = {
      fixType: 'dockerfile',
      filePath: 'docker-compose.yml',
      before: 'env_file: ./backend/.env',
      after: 'env_file: ./.env',
    };

    const mappedCall = chatEventToAssistantItem(toolCallEvent);
    const mappedResult = chatEventToAssistantItem(toolResultEvent);
    const mappedQuestion = chatEventToAssistantItem(questionEvent);

    expect(mappedCall?.type).toBe('tool_call');
    expect(mappedResult?.type).toBe('tool_result');
    expect(mappedResult?.toolName).toBe('debug_build_error');
    expect(mappedResult?.toolResult).toEqual(toolResultEvent.result);
    expect(mappedQuestion?.questionData?.metadata).toEqual({
      fixType: 'dockerfile',
      filePath: 'docker-compose.yml',
      before: 'env_file: ./backend/.env',
      after: 'env_file: ./.env',
    });

    expect(mappedCall?.toolName).toBe('debug_build_error');
    expect(mappedResult?.toolSuccess).toBe(true);
  });
});
