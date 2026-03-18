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
