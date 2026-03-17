import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => {
  const mockUseState = <T,>(initial: T): [T, (value: T | ((prev: T) => T)) => void] => [
    (typeof initial === 'boolean' ? true : initial) as unknown as T,
    () => {},
  ];
  const mockUseCallback = (fn: unknown) => fn;
  const mockCreateContext = () => ({ Provider: ({ children }: { children: unknown }) => children });
  const mockUseContext = () => ({});
  type MockElement = {
    type: unknown;
    props: Record<string, unknown> & { children: unknown[] };
  };
  return {
    useState: mockUseState,
    useCallback: mockUseCallback,
    createContext: mockCreateContext,
    useContext: mockUseContext,
    default: {
      useState: mockUseState,
      useCallback: mockUseCallback,
      createContext: mockCreateContext,
      useContext: mockUseContext,
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
