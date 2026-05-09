import { describe, expect, it } from 'vitest';
import { extractUsageFromResult } from '../../src/llm/transparency.js';

describe('extractUsageFromResult', () => {
  it('returns all zeros for undefined', () => {
    expect(extractUsageFromResult(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('returns all zeros for null', () => {
    expect(extractUsageFromResult(null)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('passes through flat numeric inputTokens/outputTokens/totalTokens unchanged', () => {
    const result = extractUsageFromResult({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
    expect(result).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });

  it('supports promptTokens/completionTokens aliases', () => {
    const result = extractUsageFromResult({ promptTokens: 10, completionTokens: 4, totalTokens: 14 });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });

  it('normalizes object-shape tokens with .total fields', () => {
    const result = extractUsageFromResult({
      inputTokens: { total: 5 },
      outputTokens: { total: 3, text: 2, reasoning: 1 },
      totalTokens: { total: 8 },
    });
    expect(result).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });

  it('falls back to inputTokens + outputTokens when totalTokens is absent (object shape)', () => {
    const result = extractUsageFromResult({
      inputTokens: { total: 6, noCache: 6, cacheRead: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    });
    expect(result).toEqual({ inputTokens: 6, outputTokens: 1, totalTokens: 7 });
  });

  it('returns zeros for corrupt string/NaN inputs', () => {
    const result = extractUsageFromResult({
      inputTokens: 'abc' as unknown as number,
      outputTokens: NaN,
    });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('returns integers (floors floats)', () => {
    const result = extractUsageFromResult({ inputTokens: 5.9, outputTokens: 3.1, totalTokens: 9.0 });
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(3);
    expect(result.totalTokens).toBe(9);
  });
});
