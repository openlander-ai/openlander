import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { Database } from '../../src/db/index.js';
import type { ChatMessage } from '../../src/llm/index.js';
import { Agent } from '../../src/llm/agent.js';
import * as compaction from '../../src/llm/compaction.js';
import { compactHistory } from '../../src/llm/compaction.js';

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: vi.fn(),
  stepCountIs: vi.fn((steps: number) => steps),
}));

function buildHistory(nonSystemMessages: number): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: 'System prompt' }];
  for (let i = 0; i < nonSystemMessages; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message-${String(i + 1)}`,
    });
  }
  return messages;
}

describe('compactHistory', () => {
  it('calls generateText and returns a summary with [Summary] prefix', async () => {
    const model = { modelId: 'test-model' } as unknown as LanguageModel;
    const messages: ChatMessage[] = [
      { role: 'user', content: 'We deployed service A.' },
      { role: 'assistant', content: 'Deployment succeeded.' },
    ];

    generateTextMock.mockResolvedValueOnce({ text: 'Deployment was completed successfully.' });

    const summary = await compactHistory(model, messages);

    expect(summary).toBe('[Summary] Deployment was completed successfully.');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        maxOutputTokens: 500,
      }),
    );
  });
});

describe('Agent compactAndTrim', () => {
  it('inserts a summary system message when history exceeds max size', async () => {
    const model = { modelId: 'test-model' } as unknown as LanguageModel;
    const db = {} as unknown as Database;
    const agent = new Agent(model, db);
    const initialHistory = buildHistory(45);

    (agent as unknown as { history: ChatMessage[] }).history = initialHistory;
    const compactSpy = vi
      .spyOn(compaction, 'compactHistory')
      .mockResolvedValueOnce('[Summary] Earlier context summary');

    await (agent as unknown as { compactAndTrim: () => Promise<void> }).compactAndTrim();

    const nextHistory = agent.getHistory();
    expect(nextHistory[1]).toEqual({
      role: 'system',
      content: '[Summary] Earlier context summary',
    });
    expect(nextHistory).toHaveLength(32);
    expect(nextHistory[nextHistory.length - 1]?.content).toBe('message-45');
    expect(compactSpy).toHaveBeenCalledWith(model, initialHistory.slice(1, -30));
  });

  it('falls back to legacy trim note when compaction fails', async () => {
    const model = { modelId: 'test-model' } as unknown as LanguageModel;
    const db = {} as unknown as Database;
    const agent = new Agent(model, db);

    (agent as unknown as { history: ChatMessage[] }).history = buildHistory(45);
    vi.spyOn(compaction, 'compactHistory').mockRejectedValueOnce(new Error('llm failed'));

    await (agent as unknown as { compactAndTrim: () => Promise<void> }).compactAndTrim();

    const nextHistory = agent.getHistory();
    expect(nextHistory[1]?.role).toBe('system');
    expect(nextHistory[1]?.content).toContain('[Earlier conversation trimmed');
    expect(nextHistory).toHaveLength(32);
    expect(nextHistory[nextHistory.length - 1]?.content).toBe('message-45');
  });
});
