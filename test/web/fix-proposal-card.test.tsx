import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../../web/src/lib/event-types.js';

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

let FixProposalCard: typeof import('../../web/src/components/timeline/FixProposalCard.js').FixProposalCard;

function renderCard(props: any) {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return FixProposalCard(props);
  } finally {
    internals.H = previousDispatcher;
  }
}

const describeCard = isBunRuntime ? describe.skip : describe;

describeCard('FixProposalCard', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ FixProposalCard } = await import('../../web/src/components/timeline/FixProposalCard.js'));
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

    expect(findTextInTree(tree, 'timeline.fixProposal.answered')).toBe(true);
  });

  it('renders fix proposal details correctly', () => {
    const tree = renderCard({
      questionId: 'q2',
      questions: [
        {
          question: 'Do you want to apply this fix?',
          options: [{ label: 'Approve' }, { label: 'Reject' }],
          metadata: {
            fixType: 'dockerfile',
            before: 'FROM node:18',
            after: 'FROM node:20',
          },
        },
      ],
      answered: false,
      onSubmit: () => {},
      onSkip: () => {},
    });

    expect(findTextInTree(tree, 'timeline.fixProposal.title')).toBe(true);
    expect(findTextInTree(tree, 'Do you want to apply this fix?')).toBe(true);
    expect(findTextInTree(tree, 'FROM node:18')).toBe(true);
    expect(findTextInTree(tree, 'FROM node:20')).toBe(true);
    expect(findTextInTree(tree, 'timeline.fixProposal.approve')).toBe(true);
    expect(findTextInTree(tree, 'timeline.fixProposal.reject')).toBe(true);
  });
});
