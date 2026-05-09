/**
 * Concurrent question handling — 1.0 GA regression guard.
 *
 * Before this fix, `Agent.chatStream` called `questionBridge.setQuestionHandler`
 * on every stream invocation. With two concurrent chat streams in flight,
 * the second call's `setQuestionHandler` overwrote the first's handler — so
 * a question raised by stream A's tool execution could be delivered to
 * stream B's UI (or simply lost).
 *
 * Option A fix: chatStream now binds its per-stream UI callback into an
 * AsyncLocalStorage context (`runWithQuestionHandler`). The
 * `ask_user_question` tool resolves the active handler at execution time
 * (`getActiveQuestionHandler`) and passes it to `bridge.ask({ handler })`.
 * The shared bridge already multiplexes pending entries by `requestId`, so
 * `bridge.reply(requestId, …)` only resolves the matching ask().
 *
 * This test verifies that two concurrent ALS contexts each see THEIR OWN
 * handler, never the other's, even though the underlying QuestionBridge is
 * shared.
 */

import { describe, expect, it } from 'vitest';

import {
  QuestionBridge,
  runWithQuestionHandler,
  getActiveQuestionHandler,
  type QuestionRequest,
} from '../../src/lib/question-bridge.js';

function makeRequest(id: string): QuestionRequest {
  return {
    id,
    questions: [
      {
        question: `Pick one for ${id}`,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ],
  };
}

describe('Concurrent question routing — per-stream ALS handler isolation', () => {
  it('two concurrent streams each receive only their own question via ALS', async () => {
    const bridge = new QuestionBridge();

    const streamAReceived: string[] = [];
    const streamBReceived: string[] = [];

    const handlerA = (req: QuestionRequest): void => {
      streamAReceived.push(req.id);
    };
    const handlerB = (req: QuestionRequest): void => {
      streamBReceived.push(req.id);
    };

    // Simulate two concurrent chatStream calls. Each runs its own ask()
    // inside its own ALS context, mimicking what `runWithQuestionHandler`
    // does inside Agent.chatStream.
    const askInsideContext = (
      handler: (req: QuestionRequest) => void,
      requestId: string,
    ): Promise<void> =>
      runWithQuestionHandler(handler, async () => {
        // The ai-sdk adapter resolves the inline handler at ask-time
        // (`getActiveQuestionHandler`) and passes it to bridge.ask.
        const inline = getActiveQuestionHandler();
        expect(inline).toBe(handler);
        const promise = bridge.ask(
          makeRequest(requestId),
          inline ? { handler: inline } : undefined,
        );
        // Resolve right away so this test stays synchronous.
        bridge.reply(requestId, []);
        await promise;
      });

    // Start both ALS contexts in parallel, NOT sequentially. This is the
    // exact race the previous setQuestionHandler pattern lost.
    await Promise.all([askInsideContext(handlerA, 'req-A'), askInsideContext(handlerB, 'req-B')]);

    expect(streamAReceived).toEqual(['req-A']);
    expect(streamBReceived).toEqual(['req-B']);
  });

  it('inline handler beats the global setQuestionHandler fallback', async () => {
    const bridge = new QuestionBridge();
    const globalReceived: string[] = [];
    const inlineReceived: string[] = [];

    bridge.setQuestionHandler((req) => {
      globalReceived.push(req.id);
    });

    await runWithQuestionHandler(
      (req) => {
        inlineReceived.push(req.id);
      },
      async () => {
        const inline = getActiveQuestionHandler();
        expect(inline).toBeDefined();
        const promise = bridge.ask(makeRequest('req-inline'), { handler: inline });
        bridge.reply('req-inline', []);
        await promise;
      },
    );

    expect(inlineReceived).toEqual(['req-inline']);
    // Global must NOT receive the question when an inline handler is
    // active — that was the leak in the prior implementation.
    expect(globalReceived).toEqual([]);
  });

  it('global setQuestionHandler still fires for non-agent flows (no ALS)', async () => {
    const bridge = new QuestionBridge();
    const globalReceived: string[] = [];

    bridge.setQuestionHandler((req) => {
      globalReceived.push(req.id);
    });

    // No runWithQuestionHandler, no ask({ handler }) — the legacy global
    // path (deploy-failure-handler, domain-routes) is preserved.
    const promise = bridge.ask(makeRequest('req-global'));
    bridge.reply('req-global', []);
    await promise;

    expect(globalReceived).toEqual(['req-global']);
  });

  it('concurrent asks resolve only against their matching requestId', async () => {
    const bridge = new QuestionBridge();
    const orderA: string[] = [];
    const orderB: string[] = [];

    const promiseA = runWithQuestionHandler(
      (req) => orderA.push(req.id),
      async () => {
        const inline = getActiveQuestionHandler();
        const ans = await bridge.ask(makeRequest('req-A'), { handler: inline });
        return { id: 'A', answers: ans };
      },
    );
    const promiseB = runWithQuestionHandler(
      (req) => orderB.push(req.id),
      async () => {
        const inline = getActiveQuestionHandler();
        const ans = await bridge.ask(makeRequest('req-B'), { handler: inline });
        return { id: 'B', answers: ans };
      },
    );

    // Reply to B first, then A — opposite order to ensure routing is
    // by requestId (not FIFO of the bridge).
    bridge.reply('req-B', [{ questionIndex: 0, selectedLabels: ['B-pick'] }]);
    bridge.reply('req-A', [{ questionIndex: 0, selectedLabels: ['A-pick'] }]);

    const [resA, resB] = await Promise.all([promiseA, promiseB]);
    expect(resA.answers[0]?.selectedLabels).toEqual(['A-pick']);
    expect(resB.answers[0]?.selectedLabels).toEqual(['B-pick']);
    // Each stream's UI handler saw only its own request.
    expect(orderA).toEqual(['req-A']);
    expect(orderB).toEqual(['req-B']);
  });
});
