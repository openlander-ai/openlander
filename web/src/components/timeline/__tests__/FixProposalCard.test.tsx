import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => {
  const mockUseState = <T,>(initial: T): [T, (value: T | ((prev: T) => T)) => void] => [
    initial,
    () => {},
  ];
  const mockUseCallback = (fn: unknown) => fn;
  type MockElement = {
    type: unknown;
    props: Record<string, unknown> & { children: unknown[] };
  };
  return {
    useState: mockUseState,
    useCallback: mockUseCallback,
    default: {
      useState: mockUseState,
      useCallback: mockUseCallback,
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
  Wrench: () => 'Wrench',
  Check: () => 'Check',
  X: () => 'X',
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
