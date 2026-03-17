import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantItem } from '../../web/src/hooks/use-assistant.js';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

interface HookDispatcher {
  useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((value: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(callback: T): T;
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
  useCallback(callback) {
    return callback;
  },
};

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
  Bug: () => 'Bug',
  FileCode2: () => 'FileCode2',
  Settings: () => 'Settings',
  MessageSquare: () => 'MessageSquare',
  Search: () => 'Search',
  Wrench: () => 'Wrench',
  Key: () => 'Key',
  MessageCircle: () => 'MessageCircle',
  Clock: () => 'Clock',
  ExternalLink: () => 'ExternalLink',
  RotateCcw: () => 'RotateCcw',
  Layers: () => 'Layers',
  LayoutList: () => 'LayoutList',
  ScrollText: () => 'ScrollText',
  Activity: () => 'Activity',
  KeyRound: () => 'KeyRound',
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

let CollapsedToolGroup: any;
let ToolCallItem: any;
let ToolResultItem: any;

function renderComponent(Component: any, props: any, expandedState = false) {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  internals.H = hookDispatcher;
  hookIndex = 0;
  hookSlots[0] = expandedState;
  if (expandedState) {
    hookSlots[1] = true;
    hookSlots[2] = true;
    hookSlots[3] = true;
    hookSlots[4] = true;
  }

  return Component(props);
}

const describeGroup = isBunRuntime ? describe.skip : describe;

describeGroup('CollapsedToolGroup', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    const mod = await import('../../web/src/components/assistant/ToolCallGroup.js');
    CollapsedToolGroup = mod.CollapsedToolGroup;
    ToolCallItem = mod.ToolCallItem;
    ToolResultItem = mod.ToolResultItem;
  });

  beforeEach(() => {
    hookSlots.length = 0;
    const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    internals.H = hookDispatcher;
  });

  it('renders fallback failure summary with truncated tool list', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'unknown_a',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'tool_call',
        toolName: 'unknown_b',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
      {
        id: '3',
        type: 'tool_call',
        toolName: 'unknown_c',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
      {
        id: '4',
        type: 'tool_call',
        toolName: 'unknown_d',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
      {
        id: '5',
        type: 'tool_result',
        toolName: 'unknown_a',
        toolSuccess: false,
        toolResult: 'error',
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Failed unknown_a, unknown_b, unknown_c +1 — 4 tools')).toBe(true);
  });

  it('renders expanded children when group starts expanded', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'deploy_project',
        toolArgs: { repo_url: 'https://example.com/repo' },
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'tool_result',
        toolName: 'deploy_project',
        toolSuccess: true,
        toolResult: { status: 'ok' },
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items }, true);
    expect(findTextInTree(tree, 'deploy_project')).toBe(true);
    expect(findTextInTree(tree, 'ok')).toBe(true);
  });

  it('renders generic fallback for unknown tools', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'unknown_tool',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Used unknown_tool — 1 tool')).toBe(true);
  });

  it('renders specific summary for deploy_project', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'deploy_project',
        toolArgs: { repo_url: 'https://github.com/test/repo' },
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Deploying https://github.com/test/repo...')).toBe(true);
  });

  it('renders specific failure summary for deploy_project', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'deploy_project',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'tool_result',
        toolName: 'deploy_project',
        toolSuccess: false,
        toolResult: 'error',
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Failed to execute deploy_project')).toBe(true);
  });

  it('renders specific summary for debug_build_error', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'debug_build_error',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Analyzing build error...')).toBe(true);
  });

  it('renders specific summary for fix_dockerfile', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'fix_dockerfile',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Generating Dockerfile fix...')).toBe(true);
  });

  it('renders specific summary for set_env_vars', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'set_env_vars',
        toolArgs: { variables: '{"KEY1":"val1","KEY2":"val2"}' },
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Setting 2 env vars...')).toBe(true);
  });

  it('renders specific summary for ask_user_question', () => {
    const items: AssistantItem[] = [
      {
        id: '1',
        type: 'tool_call',
        toolName: 'ask_user_question',
        toolArgs: {},
        timestamp: new Date().toISOString(),
      },
    ];

    const tree = renderComponent(CollapsedToolGroup, { items });
    expect(findTextInTree(tree, 'Waiting for your input...')).toBe(true);
  });

  it('renders ToolCallItem expanded with tool arguments', () => {
    const item: AssistantItem = {
      id: '10',
      type: 'tool_call',
      toolName: 'set_env_vars',
      toolArgs: { some_var: 'API_KEY' },
      timestamp: new Date().toISOString(),
    };

    const tree = renderComponent(ToolCallItem, { item }, true);
    expect(findTextInTree(tree, 'set_env_vars')).toBe(true);
    expect(findTextInTree(tree, 'API_KEY')).toBe(true);
  });

  it('renders ToolResultItem expanded for success and failure payloads', () => {
    const successItem: AssistantItem = {
      id: '11',
      type: 'tool_result',
      toolName: 'deploy_project',
      toolSuccess: true,
      toolResult: { url: 'https://demo.example.com' },
      timestamp: new Date().toISOString(),
    };
    const failureItem: AssistantItem = {
      id: '12',
      type: 'tool_result',
      toolName: 'deploy_project',
      toolSuccess: false,
      toolError: 'deploy failed',
      timestamp: new Date().toISOString(),
    };

    const successTree = renderComponent(ToolResultItem, { item: successItem }, true);
    const failureTree = renderComponent(ToolResultItem, { item: failureItem }, true);

    expect(findTextInTree(successTree, 'deploy_project ✓')).toBe(true);
    expect(findTextInTree(successTree, 'demo.example.com')).toBe(true);
    expect(findTextInTree(failureTree, 'deploy_project ✗')).toBe(true);
    expect(findTextInTree(failureTree, 'deploy failed')).toBe(true);
  });
});
