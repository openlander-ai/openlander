import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface HookDispatcher {
  useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((value: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(callback: T): T;
  useContext(context: any): any;
  useRef<T>(initialValue: T): { current: T };
  useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]): void;
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
  useContext(context) {
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === 'matches') return [{ params: { id: '123' } }];
          if (prop === 'pathname') return '/';
          if (prop === 'search') return '';
          if (prop === 'hash') return '';
          if (prop === 'state') return null;
          if (prop === 'key') return 'default';
          if (prop === 'basename') return '/';
          if (prop === 'navigator')
            return { push: vi.fn(), replace: vi.fn(), go: vi.fn(), createHref: vi.fn() };
          if (prop === 'static') return false;
          if (prop === 'location')
            return { pathname: '/', search: '', hash: '', state: null, key: 'default' };
          return undefined;
        },
      },
    );
  },
  useRef(initialValue) {
    const slotIndex = hookIndex;
    hookIndex += 1;
    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = { current: initialValue };
    }
    return hookSlots[slotIndex] as { current: any };
  },
  useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]) {},
};

vi.mock('@/lib/utils', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  Play: () => 'PlayIcon',
  Square: () => 'SquareIcon',
  Trash2: () => 'Trash2Icon',
  Database: () => 'DatabaseIcon',
  ArrowLeft: () => 'ArrowLeftIcon',
}));

vi.mock('@/components/ui/button', () => ({
  Button: function Button(props: any) {
    return props.children;
  },
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: function Spinner(props: any) {
    return null;
  },
}));

function findExactTextInTree(node: any, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node) === text;
  }
  if (Array.isArray(node)) {
    return node.some((child) => findExactTextInTree(child, text));
  }
  if (node && typeof node === 'object' && node.props) {
    if (node.props.children) {
      return findExactTextInTree(node.props.children, text);
    }
  }
  return false;
}

function findComponentInTree(node: any, typeName: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => findComponentInTree(child, typeName));
  }
  if (node && typeof node === 'object') {
    if (typeof node.type === 'function' && node.type.name === typeName) return true;
    if (typeof node.type === 'string' && node.type === typeName) return true;
    if (node.props && node.props.children) {
      return findComponentInTree(node.props.children, typeName);
    }
  }
  return false;
}

let ServiceHeader: typeof import('../../web/src/components/service/ServiceHeader.js').ServiceHeader;

function renderHeader(props: any) {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return ServiceHeader(props);
  } finally {
    internals.H = previousDispatcher;
  }
}

describe('ServiceHeader', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ ServiceHeader } = await import('../../web/src/components/service/ServiceHeader.js'));
  });

  beforeEach(() => {
    hookSlots.length = 0;
  });

  it('renders service name, image, and status correctly for running service', () => {
    const tree = renderHeader({
      service: {
        id: '1',
        name: 'my-postgres',
        image: 'postgres:15-alpine',
        status: 'running',
      },
      actionLoading: null,
      onStart: () => {},
      onStop: () => {},
      onDelete: () => {},
    });

    expect(findExactTextInTree(tree, 'my-postgres')).toBe(true);
    expect(findExactTextInTree(tree, 'postgres:15-alpine')).toBe(true);
    expect(findExactTextInTree(tree, 'Running')).toBe(true);
    expect(findExactTextInTree(tree, 'Stop')).toBe(true);
    expect(findExactTextInTree(tree, 'Delete')).toBe(true);
    expect(findExactTextInTree(tree, 'Start')).toBe(false);
  });

  it('renders correctly for stopped service', () => {
    const tree = renderHeader({
      service: {
        id: '1',
        name: 'my-redis',
        image: 'redis:7-alpine',
        status: 'stopped',
      },
      actionLoading: null,
      onStart: () => {},
      onStop: () => {},
      onDelete: () => {},
    });

    expect(findExactTextInTree(tree, 'my-redis')).toBe(true);
    expect(findExactTextInTree(tree, 'redis:7-alpine')).toBe(true);
    expect(findExactTextInTree(tree, 'Stopped')).toBe(true);
    expect(findExactTextInTree(tree, 'Start')).toBe(true);
    expect(findExactTextInTree(tree, 'Delete')).toBe(true);
    expect(findExactTextInTree(tree, 'Stop')).toBe(false);
  });

  it('shows spinner when action is loading', () => {
    const tree = renderHeader({
      service: {
        id: '1',
        name: 'my-redis',
        image: 'redis:7-alpine',
        status: 'stopped',
      },
      actionLoading: 'start',
      onStart: () => {},
      onStop: () => {},
      onDelete: () => {},
    });

    expect(findComponentInTree(tree, 'Spinner')).toBe(true);
  });
});
