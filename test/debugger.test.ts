import { beforeEach, describe, it, expect, vi } from 'vitest';

import { BuildDebugger } from '../src/agent/debugger.js';
import type { LanguageModel } from 'ai';

// Mock generateText from 'ai' module
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';
const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>;

/**
 * Create a mock LanguageModel that satisfies the AI SDK interface.
 * The actual model is never called directly — generateText is mocked.
 */
function createMockModel(): LanguageModel {
  return {
    modelId: 'mock-model',
    specificationVersion: 'v2',
    provider: 'mock',
    defaultObjectGenerationMode: 'json',
    supportsUrl: () => false,
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModel;
}

function mockLLMResponse(text: string) {
  mockGenerateText.mockResolvedValueOnce({
    text,
    steps: [],
    toolCalls: [],
    toolResults: [],
    finishReason: 'stop',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    response: { id: 'test', timestamp: new Date(), modelId: 'mock', headers: {} },
    warnings: [],
    providerMetadata: {},
    sources: [],
    reasoning: [],
    files: [],
    rawResponse: undefined,
  } as unknown as Awaited<ReturnType<typeof generateText>>);
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
    const model = createMockModel();
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'npm ERR! gyp ERR! build error\nnode-gyp rebuild failed',
    });

    expect(result.summary).toContain('node-gyp');
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.suggestedFixes[0]!.confidence).toBe('high');
    expect(result.rawAnalysis).toContain('Matched recipe');
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns recipe diagnosis for OOM errors without calling LLM', async () => {
    const model = createMockModel();
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'FATAL ERROR: JavaScript heap out of memory',
    });

    expect(result.summary).toContain('memory');
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns recipe diagnosis for COPY errors without calling LLM', async () => {
    const model = createMockModel();
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'COPY failed: stat /var/lib/docker/tmp/abc: no such file or directory',
    });

    expect(result.summary).toContain('COPY');
    expect(mockGenerateText).not.toHaveBeenCalled();
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

    const model = createMockModel();
    mockLLMResponse(validJson);
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'some completely unknown error that matches no recipe',
    });

    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(result.summary).toBe('Unknown build error');
    expect(result.rootCause).toBe('The Dockerfile uses an unsupported instruction');
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.suggestedFixes[0]!.confidence).toBe('medium');
  });

  it('parses fenced JSON from LLM response', async () => {
    const fenced =
      '```json\n{"summary":"Build failed","rootCause":"Missing dep","suggestedFixes":[]}\n```';

    const model = createMockModel();
    mockLLMResponse(fenced);
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.diagnose({
      ...baseContext,
      buildLog: 'unique error no recipe matches xyz123',
    });

    expect(result.summary).toBe('Build failed');
    expect(result.rootCause).toBe('Missing dep');
    expect(result.suggestedFixes).toHaveLength(0);
  });

  it('handles malformed LLM response gracefully', async () => {
    const model = createMockModel();
    mockLLMResponse('This is not JSON at all, just plain text about the error.');
    const debugger_ = new BuildDebugger(model);

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
    const model = createMockModel();
    mockLLMResponse(partial);
    const debugger_ = new BuildDebugger(model);

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

describe('BuildDebugger — fixDockerfile', () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  it('generates fixed Dockerfile from LLM response with CHANGES section', async () => {
    const llmResponse = [
      'FROM node:20-alpine AS builder',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci',
      'COPY . .',
      'RUN npm run build',
      '',
      'FROM node:20-alpine',
      'WORKDIR /app',
      'COPY --from=builder /app/.next ./.next',
      'COPY --from=builder /app/node_modules ./node_modules',
      'COPY --from=builder /app/package.json ./package.json',
      'EXPOSE 3000',
      'CMD ["npm", "start"]',
      '',
      'CHANGES:',
      '- Updated Node.js from 18.20.4 to 20 (Alpine)',
      '- Fixed missing .next directory copy in production stage',
    ].join('\n');

    const model = createMockModel();
    mockLLMResponse(llmResponse);
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.fixDockerfile({
      projectPath: '/tmp/test',
      currentDockerfile: 'FROM node:18-alpine\nCOPY . .\nRUN npm install',
      buildError: 'error: Next.js requires Node.js >= 20.9.0',
      projectName: 'test-app',
    });

    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(result.dockerfileContent).toContain('FROM node:20-alpine');
    expect(result.dockerfileContent).not.toContain('CHANGES:');
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toContain('Updated Node.js');
    expect(result.explanation).toBeTruthy();
  });

  it('handles LLM response without CHANGES section', async () => {
    const llmResponse =
      'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\nEXPOSE 3000\nCMD ["npm", "start"]';

    const model = createMockModel();
    mockLLMResponse(llmResponse);
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.fixDockerfile({
      projectPath: '/tmp/test',
      currentDockerfile: 'FROM node:18\nCOPY . .',
      buildError: 'some build error',
      projectName: 'test-app',
    });

    expect(result.dockerfileContent).toContain('FROM node:20-alpine');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toContain('Dockerfile updated');
  });

  it('strips markdown fences from LLM Dockerfile response', async () => {
    const llmResponse =
      '```dockerfile\nFROM node:20\nCOPY . .\nRUN npm install\n```\n\nCHANGES:\n- Fixed Node version';

    const model = createMockModel();
    mockLLMResponse(llmResponse);
    const debugger_ = new BuildDebugger(model);

    const result = await debugger_.fixDockerfile({
      projectPath: '/tmp/test',
      currentDockerfile: 'FROM node:16',
      buildError: 'version not supported',
      projectName: 'test-app',
    });

    expect(result.dockerfileContent).not.toContain('```');
    expect(result.dockerfileContent).toContain('FROM node:20');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toContain('Fixed Node version');
  });
});
