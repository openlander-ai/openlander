import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionBridge, type QuestionRequest } from '../src/agent/question-bridge.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function createRequest(id = 'req-1'): QuestionRequest {
  return {
    id,
    questions: [
      {
        question: 'Pick one option',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ],
  };
}

describe('QuestionBridge timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects ask() after 5 minutes with a clear timeout message', async () => {
    const bridge = new QuestionBridge();
    const promise = bridge.ask(createRequest());
    const rejection = expect(promise).rejects.toThrow(
      'Session timed out — user did not respond within 5 minutes',
    );

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS);

    await rejection;
    expect(bridge.hasPending()).toBe(false);
  });

  it('clears timeout when reply() resolves the pending question', async () => {
    const bridge = new QuestionBridge();
    const request = createRequest();
    const expectedAnswers = [{ questionIndex: 0, selectedLabels: ['A'] }];
    const promise = bridge.ask(request);

    bridge.reply(request.id, expectedAnswers);

    await expect(promise).resolves.toEqual(expectedAnswers);
    expect(bridge.hasPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timeout when reject() resolves with empty answers', async () => {
    const bridge = new QuestionBridge();
    const promise = bridge.ask(createRequest('req-2'));

    bridge.reject();

    await expect(promise).resolves.toEqual([]);
    expect(bridge.hasPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
