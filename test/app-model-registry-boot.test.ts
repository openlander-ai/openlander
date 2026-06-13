import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AppContext model registry boot config', () => {
  const source = readFileSync('src/app.ts', 'utf8');

  it('boots ModelRegistry from persisted LLM provider routes', () => {
    expect(source).toMatch(
      /new ModelRegistry\(\s*normalizeLlmConfig\(config\.llm\),\s*eventBus,\s*llmCircuitBreaker,\s*\)/,
    );
  });

  it('does not discard saved provider routes by booting with an empty registry config', () => {
    expect(source).not.toMatch(
      /new ModelRegistry\(\s*\{\s*providers:\s*\{\},\s*defaultRoute:\s*\{\s*providerId:\s*['"]__none__['"]\s*\}/,
    );
  });
});
