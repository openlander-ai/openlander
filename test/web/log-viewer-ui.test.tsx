import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConsoleLogEntries,
  createMockUseLogStreamResult,
} from '../helpers/console-fixtures.js';

type SearchState = {
  searchMode: 'text' | 'regex';
  searchQuery: string;
  logLevel: 'all' | 'error' | 'warn' | 'info' | 'debug' | 'plain';
};

interface HookDispatcher {
  useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((value: T) => T)) => void];
  useReducer<T>(reducer: (state: T) => T, initial: T): readonly [T, () => void];
  useEffect(effect: () => void | (() => void)): void;
  useLayoutEffect(effect: () => void | (() => void)): void;
  useMemo<T>(factory: () => T): T;
  useCallback<T extends (...args: never[]) => unknown>(callback: T): T;
  useRef<T>(initialValue: T): { current: T };
}

interface ReactClientInternals {
  H: HookDispatcher | null;
}

interface ReactModuleLike {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
}

type RenderNode = string | number | boolean | null | undefined | RenderElement | RenderNode[];

interface RenderElement {
  type: unknown;
  props: {
    children?: RenderNode;
    dangerouslySetInnerHTML?: { __html: string };
    [key: string]: unknown;
  };
}

const messages = {
  'logs.loadingTitle': 'Connecting to live logs',
  'logs.loadingBody':
    'Waiting for the stream to respond. New output appears here as soon as it arrives.',
  'logs.emptyTitle': 'No logs yet',
  'logs.emptyBody': 'This project has not written any runtime output yet.',
  'logs.errorTitle': 'Log stream failed',
  'logs.errorBody': 'The live stream hit a transient error. Retry to resume log updates.',
  'logs.disconnectedTitle': 'Live follow disconnected',
  'logs.disconnectedBody': 'The last logs stay visible, but new lines stop until you reconnect.',
  'logs.disconnectedInlineBody': 'Live updates stopped. Reconnect to keep following fresh output.',
  'logs.noMatchingTitle': 'No matching lines',
  'logs.noMatchingBody': 'Adjust the search or level filter to see log lines again.',
  'logs.retryStream': 'Reconnect stream',
  'logs.clearFilters': 'Clear filters',
} as const;

let currentStreamResult = createMockUseLogStreamResult();
const scrollToIndex = vi.fn<(index: number, options?: { align?: string }) => void>();
let ReactModule: ReactModuleLike;
let hookIndex = 0;
const hookSlots: unknown[] = [];

function initializeFilters(): SearchState {
  return {
    searchMode: 'text',
    searchQuery: '',
    logLevel: 'all',
  };
}

vi.mock('@/hooks/use-log-stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../web/src/hooks/use-log-stream.js')>();
  return {
    ...actual,
    useLogStream: () => currentStreamResult,
  };
});

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' '),
}));

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: keyof typeof messages) => messages[key] ?? key,
  }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 24,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        size: 24,
        start: index * 24,
      })),
    scrollToIndex,
  }),
}));

vi.mock('@/lib/ansi', () => ({
  parseAnsiLine: (line: string) => line,
  stripAnsi: (line: string) => line,
  normalizeLogText: (line: string) => line,
}));

let LogViewer: typeof import('../../web/src/components/logs/LogViewer.js').LogViewer;

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
  useReducer<T>(reducer: (state: T) => T, initial: T) {
    const slotIndex = hookIndex;
    hookIndex += 1;

    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = initial;
    }

    const dispatch = () => {
      hookSlots[slotIndex] = reducer(hookSlots[slotIndex] as T);
    };

    return [hookSlots[slotIndex] as T, dispatch] as const;
  },
  useEffect(effect) {
    effect();
  },
  useLayoutEffect(effect) {
    effect();
  },
  useMemo(factory) {
    return factory();
  },
  useCallback(callback) {
    return callback;
  },
  useRef(initialValue) {
    const slotIndex = hookIndex;
    hookIndex += 1;

    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = { current: initialValue };
    }

    return hookSlots[slotIndex] as { current: typeof initialValue };
  },
};

function isRenderElement(value: RenderNode): value is RenderElement {
  return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function collectText(node: RenderNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => collectText(child)).join(' ');
  }

  if (!isRenderElement(node)) {
    return '';
  }

  const innerHtml = node.props.dangerouslySetInnerHTML?.__html ?? '';
  return `${collectText(node.props.children)} ${innerHtml}`.trim();
}

function normalizeText(node: RenderNode): string {
  return collectText(node).replace(/\s+/g, ' ').trim();
}

function visitTree(node: RenderNode, visitor: (element: RenderElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      visitTree(child, visitor);
    }
    return;
  }

  if (!isRenderElement(node)) {
    return;
  }

  visitor(node);
  visitTree(node.props.children, visitor);
}

function findElement(
  node: RenderNode,
  predicate: (element: RenderElement) => boolean,
): RenderElement {
  let match: RenderElement | undefined;

  visitTree(node, (element) => {
    if (match === undefined && predicate(element)) {
      match = element;
    }
  });

  if (match === undefined) {
    throw new Error('Expected matching element in rendered tree');
  }

  return match;
}

function renderLogViewer() {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return LogViewer({ projectId: 'project-1' });
  } finally {
    internals.H = previousDispatcher;
  }
}

describe('LogViewer UI behavior', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ LogViewer } = await import('../../web/src/components/logs/LogViewer.js'));
  });

  beforeEach(() => {
    hookSlots.length = 0;
    hookSlots.push(initializeFilters());
    currentStreamResult = createMockUseLogStreamResult();
    scrollToIndex.mockReset();
  });

  it('updates visible log output for search and level filter changes', () => {
    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: createConsoleLogEntries([
          'info: build booted successfully',
          'error: disk full on /data',
          'warn: cache miss during warmup',
        ]),
        connectionState: 'live',
      },
    });

    let tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('3 lines');

    const searchInput = findElement(
      tree,
      (element) => element.type === 'input' && element.props.placeholder === 'Search logs...',
    );
    const onSearchChange = searchInput.props.onChange;
    expect(typeof onSearchChange).toBe('function');
    if (typeof onSearchChange === 'function') {
      onSearchChange({ target: { value: 'disk' } });
    }

    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('1 / 3 lines');

    const levelSelect = findElement(tree, (element) => element.type === 'select');
    const onLevelChange = levelSelect.props.onChange;
    expect(typeof onLevelChange).toBe('function');
    if (typeof onLevelChange === 'function') {
      onLevelChange({ target: { value: 'warn' } });
    }

    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('No matching lines');
    expect(normalizeText(tree)).toContain('Clear filters');

    const clearFiltersButton = findElement(
      tree,
      (element) => element.type === 'button' && collectText(element) === 'Clear filters',
    );
    const onClearFilters = clearFiltersButton.props.onClick;
    expect(typeof onClearFilters).toBe('function');
    if (typeof onClearFilters === 'function') {
      onClearFilters();
    }

    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('3 lines');
  });

  it('keeps empty, error, and disconnected states visually distinct', () => {
    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: [],
        connectionState: 'live',
      },
    });
    let tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('No logs yet');
    expect(normalizeText(tree)).toContain('This project has not written any runtime output yet.');

    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: [],
        connectionState: 'live',
        error: 'socket timeout',
      },
    });
    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('Log stream failed');
    expect(normalizeText(tree)).toContain('socket timeout');
    expect(normalizeText(tree)).toContain('Reconnect stream');

    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: [],
        connectionState: 'disconnected',
      },
    });
    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('Live follow disconnected');
    expect(normalizeText(tree)).toContain(
      'The last logs stay visible, but new lines stop until you reconnect.',
    );
    expect(normalizeText(tree)).toContain('Reconnect stream');
  });

  it('wires follow controls and recovery banners to stream actions', () => {
    const pauseFollowing = vi.fn();
    const jumpToLatest = vi.fn();

    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: createConsoleLogEntries(['error: worker crashed']),
        connectionState: 'disconnected',
        followMode: 'follow',
      },
      pauseFollowing,
      jumpToLatest,
    });

    let tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('Follow');
    expect(normalizeText(tree)).toContain('Live follow disconnected');
    expect(normalizeText(tree)).toContain(
      'Live updates stopped. Reconnect to keep following fresh output.',
    );

    const followButton = findElement(
      tree,
      (element) => element.type === 'button' && collectText(element).includes('Follow'),
    );
    const onFollowClick = followButton.props.onClick;
    expect(typeof onFollowClick).toBe('function');
    if (typeof onFollowClick === 'function') {
      onFollowClick();
    }
    expect(pauseFollowing).toHaveBeenCalledTimes(1);

    const reconnectButton = findElement(
      tree,
      (element) => element.type === 'button' && collectText(element) === 'Reconnect stream',
    );
    const onReconnectClick = reconnectButton.props.onClick;
    expect(typeof onReconnectClick).toBe('function');
    if (typeof onReconnectClick === 'function') {
      onReconnectClick();
    }
    expect(jumpToLatest).toHaveBeenCalledTimes(1);

    currentStreamResult = createMockUseLogStreamResult({
      state: {
        entries: createConsoleLogEntries(['plain: older line']),
        connectionState: 'live',
        followMode: 'paused',
        unseenCount: 4,
      },
      jumpToLatest,
    });

    tree = renderLogViewer();
    expect(normalizeText(tree)).toContain('Paused');
    expect(normalizeText(tree)).toContain('Jump to latest (4)');

    const pausedButton = findElement(
      tree,
      (element) => element.type === 'button' && collectText(element).includes('Paused'),
    );
    const onPausedClick = pausedButton.props.onClick;
    expect(typeof onPausedClick).toBe('function');
    if (typeof onPausedClick === 'function') {
      onPausedClick();
    }
    expect(jumpToLatest).toHaveBeenCalledTimes(2);
  });
});
