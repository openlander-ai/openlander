import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  Wrench: () => 'Wrench',
  Check: () => 'Check',
  X: () => 'X',
  FileCode2: () => 'FileCode2',
  AlertCircle: () => 'AlertCircle',
}));

function findTextInTree(node: any, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => findTextInTree(child, text));
  }
  if (node && typeof node === 'object' && node.props) {
    if (node.props.children) {
      return findTextInTree(node.props.children, text);
    }
  }
  return false;
}

let ComposeErrorCard: typeof import('../../web/src/components/timeline/ComposeErrorCard.js').ComposeErrorCard;

function renderCard(props: any) {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return ComposeErrorCard(props);
  } finally {
    internals.H = previousDispatcher;
  }
}

const describeCard = isBunRuntime ? describe.skip : describe;

describeCard('ComposeErrorCard', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ ComposeErrorCard } = await import('../../web/src/components/timeline/ComposeErrorCard.js'));
  });

  beforeEach(() => {
    hookSlots.length = 0;
  });

  it('renders answered state correctly', () => {
    const tree = renderCard({
      questionId: 'q1',
      questions: [],
      answered: true,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.composeError.answered')).toBe(true);
  });

  it('renders compose error details and patterns correctly', () => {
    const tree = renderCard({
      questionId: 'q2',
      questions: [
        {
          question: 'How would you like to provide the environment variables?',
          options: [
            { label: 'Root .env' },
            { label: 'Selective injection' },
            { label: 'Per-service files' },
          ],
          metadata: {
            fixType: 'compose',
            errorType: 'env_file_missing',
            patterns: [
              {
                id: 'root_env',
                name: 'Root .env',
                description: 'Use a single .env file at the root of the project.',
                codeSnippet: 'env_file: .env',
                recommended: true,
              },
              {
                id: 'selective',
                name: 'Selective injection',
                description: 'Inject specific variables from the host environment.',
                codeSnippet: 'environment:\n  - KEY=${KEY}',
                recommended: false,
              },
              {
                id: 'per_service',
                name: 'Per-service files',
                description: 'Use separate .env files for each service.',
                codeSnippet: 'env_file: ./env/backend.env',
                recommended: false,
              },
            ],
          },
        },
      ],
      answered: false,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.composeError.title')).toBe(true);
    expect(findTextInTree(tree, 'How would you like to provide the environment variables?')).toBe(
      true,
    );
    expect(findTextInTree(tree, 'Root .env')).toBe(true);
    expect(findTextInTree(tree, 'env_file: .env')).toBe(true);
    expect(findTextInTree(tree, 'Selective injection')).toBe(true);
    expect(findTextInTree(tree, 'environment:\n  - KEY=${KEY}')).toBe(true);
    expect(findTextInTree(tree, 'Per-service files')).toBe(true);
    expect(findTextInTree(tree, 'env_file: ./env/backend.env')).toBe(true);
  });
});
