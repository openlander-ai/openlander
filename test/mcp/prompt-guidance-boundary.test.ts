import { describe, expect, it, vi } from 'vitest';

import { registerMcpPrompts } from '../../src/mcp/prompts.js';

type PromptHandler = (request: { params: Record<string, unknown> }) => unknown;

function getPromptHandler(): PromptHandler {
  const handlers: PromptHandler[] = [];
  registerMcpPrompts({
    setRequestHandler: vi.fn((_schema: unknown, handler: PromptHandler) => {
      handlers.push(handler);
    }),
  });
  expect(handlers).toHaveLength(2);
  return handlers[1]!;
}

async function deploymentGuide(projectType: string): Promise<string> {
  const result = (await getPromptHandler()({
    params: { name: 'deployment-guide', arguments: { project_type: projectType } },
  })) as { messages: Array<{ content: { text: string } }> };
  return result.messages[0]!.content.text;
}

describe('MCP prompt guidance boundary', () => {
  it('keeps Python notes to OpenLander-owned networking and connection behavior', async () => {
    const prompt = await deploymentGuide('fastapi');

    expect(prompt).toContain('Python / OpenLander Contract');
    expect(prompt).toContain('does not rewrite an application bind address');
    expect(prompt).toContain('does not add ORM- or driver-specific scheme suffixes');
    expect(prompt).not.toMatch(/pip install|uvicorn|SQLAlchemy/);
  });

  it('keeps framework build notes factual instead of recommending source architecture', async () => {
    const nextPrompt = await deploymentGuide('nextjs');
    const javaPrompt = await deploymentGuide('spring-boot');

    expect(nextPrompt).toContain('NEXT_PUBLIC_*');
    expect(nextPrompt).not.toContain("output: 'standalone'");
    expect(javaPrompt).toContain('does not translate it into framework-specific JDBC');
    expect(javaPrompt).not.toMatch(/multi-stage Docker build|Maven|Gradle|JAVA_OPTS/);
  });
});
