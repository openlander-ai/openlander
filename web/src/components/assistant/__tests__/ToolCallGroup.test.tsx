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

import { ToolCallItem, ToolResultItem } from '../ToolCallGroup';
import type { AssistantItem } from '@/hooks/use-assistant';

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

vi.mock('@/lib/time', () => ({
  formatTime: () => '12:00 PM',
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

describe('ToolCallGroup', () => {
  it('masks secrets in tool arguments', () => {
    const item: AssistantItem = {
      id: '1',
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      toolName: 'set_env_vars',
      toolArgs: {
        variables: {
          DATABASE_URL: 'postgres://user:password@localhost:5432/db',
          SECRET_KEY: 'super-secret-key',
        },
      },
    };

    const tree = ToolCallItem({ item });

    expect(findTextInTree(tree, 'DATABASE_URL')).toBe(true);
    expect(findTextInTree(tree, 'super-secret-key')).toBe(false);
    expect(findTextInTree(tree, '[redacted]')).toBe(true);
  });

  it('renders rich UI for known tool results instead of raw JSON', () => {
    const item: AssistantItem = {
      id: '2',
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      toolName: 'deploy_project',
      toolSuccess: true,
      toolResult: {
        projectName: 'my-project',
        status: 'running',
        url: 'https://my-project.example.com',
      },
    };

    const tree = ToolResultItem({ item });

    expect(findTextInTree(tree, 'my-project')).toBe(true);
    expect(findTextInTree(tree, 'my-project.example.com')).toBe(true);

    expect(findTextInTree(tree, '"projectName": "my-project"')).toBe(false);
  });

  it('masks secrets in fallback JSON rendering', () => {
    const item: AssistantItem = {
      id: '3',
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      toolName: 'unknown_tool',
      toolSuccess: true,
      toolResult: {
        someData: 'data',
        password: 'my-secret-password',
      },
    };

    const tree = ToolResultItem({ item });

    expect(findTextInTree(tree, 'someData')).toBe(true);
    expect(findTextInTree(tree, 'my-secret-password')).toBe(false);
    expect(findTextInTree(tree, '[redacted]')).toBe(true);
  });
});
