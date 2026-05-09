import { describe, it, expect } from 'vitest';
import { toTimelineItem } from '../web/src/lib/event-types';

describe('toTimelineItem', () => {
  it('maps needs_user_action event with category and detail', () => {
    const item = toTimelineItem({
      type: 'needs_user_action',
      message: 'Invalid credentials',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      category: 'CLONE_AUTH_FAILURE',
      userDetail: 'SSH key not found for this repository',
    });

    expect(item.type).toBe('needs_user_action');
    expect(item.title).toBe('Invalid credentials');
    expect(item.percent).toBe(-1);
    expect(item.category).toBe('CLONE_AUTH_FAILURE');
    expect(item.detail).toBe('SSH key not found for this repository');
  });

  it('maps needs_user_action event falling back to detail field', () => {
    const item = toTimelineItem({
      type: 'needs_user_action',
      message: 'Docker build failed',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      category: 'DOCKERFILE_SYNTAX',
      detail: 'Syntax error on line 5',
    });

    expect(item.type).toBe('needs_user_action');
    expect(item.title).toBe('Docker build failed');
    expect(item.category).toBe('DOCKERFILE_SYNTAX');
    expect(item.detail).toBe('Syntax error on line 5');
  });

  it('preserves question metadata in question_pending events', () => {
    const item = toTimelineItem({
      type: 'question_pending',
      message: 'Apply this fix?',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      questionId: 'q-fix-1',
      questions: [
        {
          question: 'Apply this fix?',
          options: [{ label: 'Yes' }, { label: 'No' }],
          metadata: {
            fixType: 'dockerfile',
            filePath: 'Dockerfile',
          },
        },
      ],
    });

    expect(item.type).toBe('question');
    expect(item.questions?.[0]?.metadata).toEqual({
      fixType: 'dockerfile',
      filePath: 'Dockerfile',
    });
  });
});
