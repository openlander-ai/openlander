import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => {
  const mockUseState = <T,>(initial: T): [T, (value: T | ((prev: T) => T)) => void] => [
    (typeof initial === 'boolean' ? true : initial) as unknown as T,
    () => {},
  ];
  const mockUseRef = <T,>(initial: T) => ({ current: initial });
  const mockUseEffect = () => {};
  const mockUseCallback = (fn: unknown) => fn;
  const mockUseMemo = (fn: () => unknown) => fn();
  const mockCreateContext = () => ({
    Provider: ({ children }: { children: unknown }) => children,
    Consumer: ({ children }: { children: unknown }) => children,
  });
  const mockUseContext = () => ({});
  const mockMemo = (c: unknown) => c;
  const mockForwardRef = (c: unknown) => c;

  class MockComponent<P = unknown> {
    props: P;

    constructor(props: P) {
      this.props = props;
    }
  }

  type MockElement = {
    type: unknown;
    props: Record<string, unknown> & { children: unknown[] };
  };

  return {
    useState: mockUseState,
    useRef: mockUseRef,
    useEffect: mockUseEffect,
    useLayoutEffect: mockUseEffect,
    useCallback: mockUseCallback,
    useMemo: mockUseMemo,
    createContext: mockCreateContext,
    useContext: mockUseContext,
    memo: mockMemo,
    forwardRef: mockForwardRef,
    Component: MockComponent,
    default: {
      useState: mockUseState,
      useRef: mockUseRef,
      useEffect: mockUseEffect,
      useLayoutEffect: mockUseEffect,
      useCallback: mockUseCallback,
      useMemo: mockUseMemo,
      createContext: mockCreateContext,
      useContext: mockUseContext,
      memo: mockMemo,
      forwardRef: mockForwardRef,
      Component: MockComponent,
    },
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

import { FixProposalCard } from '../FixProposalCard';
import type { QuestionData } from '@/lib/event-types';

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  Bot: () => 'Bot',
  ChevronDown: () => 'ChevronDown',
  ChevronUp: () => 'ChevronUp',
  CheckCircle2: () => 'CheckCircle2',
  XCircle: () => 'XCircle',
  Rocket: () => 'Rocket',
  Search: () => 'Search',
  Wrench: () => 'Wrench',
  Key: () => 'Key',
  MessageCircle: () => 'MessageCircle',
  Clock: () => 'Clock',
  LayoutList: () => 'LayoutList',
  ScrollText: () => 'ScrollText',
  Activity: () => 'Activity',
  KeyRound: () => 'KeyRound',
  ExternalLink: () => 'ExternalLink',
  RotateCcw: () => 'RotateCcw',
  Layers: () => 'Layers',
  Menu: () => 'Menu',
  Cpu: () => 'Cpu',
  MemoryStick: () => 'MemoryStick',
  Bell: () => 'Bell',
  HardDrive: () => 'HardDrive',
  AlertTriangle: () => 'AlertTriangle',
  AlertCircle: () => 'AlertCircle',
  Info: () => 'Info',
  X: () => 'X',
  ArrowRight: () => 'ArrowRight',
  Archive: () => 'Archive',
  Container: () => 'Container',
  Network: () => 'Network',
  Server: () => 'Server',
  Play: () => 'Play',
  Square: () => 'Square',
  RefreshCw: () => 'RefreshCw',
  Trash2: () => 'Trash2',
  Globe: () => 'Globe',
  Globe2: () => 'Globe2',
  Loader2: () => 'Loader2',
  Terminal: () => 'Terminal',
  Settings: () => 'Settings',
  LogOut: () => 'LogOut',
  ChevronRight: () => 'ChevronRight',
  ChevronLeft: () => 'ChevronLeft',
  Plus: () => 'Plus',
  MoreVertical: () => 'MoreVertical',
  MoreHorizontal: () => 'MoreHorizontal',
  Edit: () => 'Edit',
  Copy: () => 'Copy',
  Check: () => 'Check',
  FileCode2: () => 'FileCode2',
  Send: () => 'Send',
  SkipForward: () => 'SkipForward',
  MessageCircleQuestion: () => 'MessageCircleQuestion',
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

describe('FixProposalCard', () => {
  it('renders answered state', () => {
    const tree = FixProposalCard({
      questionId: 'q1',
      questions: [],
      answered: true,
      onSubmit: () => {},
      onSkip: () => {},
    });
    expect(findTextInTree(tree, 'timeline.fixProposal.answered')).toBe(true);
  });

  it('renders metadata.changes when present', () => {
    const questions: QuestionData[] = [
      {
        question: 'Do you want to apply this fix?',
        options: [{ label: 'Approve' }, { label: 'Reject' }],
        metadata: {
          changes: ['Added missing import', 'Fixed typo'],
        },
      },
    ];

    const tree = FixProposalCard({
      questionId: 'q1',
      questions,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.fixProposal.changes')).toBe(true);
    expect(findTextInTree(tree, 'Added missing import')).toBe(true);
    expect(findTextInTree(tree, 'Fixed typo')).toBe(true);
  });

  it('recognizes "Show me other options" as an alternative option', () => {
    const questions: QuestionData[] = [
      {
        question: 'Do you want to apply this fix?',
        options: [{ label: 'Approve' }, { label: 'Reject' }, { label: 'Show me other options' }],
      },
    ];

    const tree = FixProposalCard({
      questionId: 'q1',
      questions,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.fixProposal.showAlternatives')).toBe(true);
  });

  it('recognizes "alternative" as an alternative option', () => {
    const questions: QuestionData[] = [
      {
        question: 'Do you want to apply this fix?',
        options: [{ label: 'Approve' }, { label: 'Reject' }, { label: 'Alternative fix' }],
      },
    ];

    const tree = FixProposalCard({
      questionId: 'q1',
      questions,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.fixProposal.showAlternatives')).toBe(true);
  });
});
