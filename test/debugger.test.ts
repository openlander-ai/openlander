import { describe, it, expect, vi } from 'vitest';

import { BuildDebugger } from '../src/agent/debugger.js';
import type { LLMClient, ChatMessage, LLMResponse } from '../src/llm/index.js';

function createMockLLM(response: string): LLMClient {
  return {
    chat: vi.fn<(messages: ChatMessage[]) => Promise<LLMResponse>>().mockResolvedValue({
      content: response,
    }),
  };
}

const baseContext = {
  buildLog: 'generic error output',
  dockerfile: 'FROM node:22\nCOPY . .\nRUN npm install',
  projectName: 'test-app',
  imageTag: 'test-app:latest',
  failedStep: 'build',
};

describe('BuildDebugger — recipe shortcircuit', () => {
  it('returns recipe diagnosis for node-gyp errors without calling LLM', async () => {
    const llm = createMockLLM('should not be called');
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'npm ERR! gyp ERR! build error\nnode-gyp rebuild failed',
    });

    expect(result.summary).toContain('node-gyp');
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.suggestedFixes[0]!.confidence).toBe('high');
    expect(result.rawAnalysis).toContain('Matched recipe');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('returns recipe diagnosis for OOM errors without calling LLM', async () => {
    const llm = createMockLLM('should not be called');
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'FATAL ERROR: JavaScript heap out of memory',
    });

    expect(result.summary).toContain('memory');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('returns recipe diagnosis for COPY errors without calling LLM', async () => {
    const llm = createMockLLM('should not be called');
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'COPY failed: stat /var/lib/docker/tmp/abc: no such file or directory',
    });

    expect(result.summary).toContain('COPY');
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe('BuildDebugger — LLM fallback', () => {
  it('calls LLM when no recipe matches', async () => {
    const validJson = JSON.stringify({
      summary: 'Unknown build error',
      rootCause: 'The Dockerfile uses an unsupported instruction',
      suggestedFixes: [
        { description: 'Check Dockerfile syntax', location: 'Dockerfile:5', confidence: 'medium' },
      ],
    });

    const llm = createMockLLM(validJson);
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'some completely unknown error that matches no recipe',
    });

    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result.summary).toBe('Unknown build error');
    expect(result.rootCause).toBe('The Dockerfile uses an unsupported instruction');
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.suggestedFixes[0]!.confidence).toBe('medium');
  });

  it('parses fenced JSON from LLM response', async () => {
    const fenced =
      '```json\n{"summary":"Build failed","rootCause":"Missing dep","suggestedFixes":[]}\n```';
    const llm = createMockLLM(fenced);
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'unique error no recipe matches xyz123',
    });

    expect(result.summary).toBe('Build failed');
    expect(result.rootCause).toBe('Missing dep');
    expect(result.suggestedFixes).toHaveLength(0);
  });

  it('handles malformed LLM response gracefully', async () => {
    const llm = createMockLLM('This is not JSON at all, just plain text about the error.');
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'unique error no recipe matches abc456',
    });

    // Should return a fallback diagnosis instead of throwing
    expect(result.summary).toContain('could not parse');
    expect(result.rawAnalysis).toContain('not JSON');
  });

  it('handles partially valid JSON from LLM', async () => {
    const partial = JSON.stringify({ summary: 'Partial result' });
    const llm = createMockLLM(partial);
    const debugger_ = new BuildDebugger(llm);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'unique error no recipe matches def789',
    });

    expect(result.summary).toBe('Partial result');
    // Missing rootCause should get default
    expect(result.rootCause).toBe('No root cause provided');
    expect(result.suggestedFixes).toHaveLength(0);
  });
});
