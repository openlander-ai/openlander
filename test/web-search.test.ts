import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDuckSearch, mockFetch } = vi.hoisted(() => ({
  mockDuckSearch: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('duck-duck-scrape', () => ({
  search: mockDuckSearch,
}));

import { webSearch } from '../src/lib/web-search.js';

describe('webSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses duck-duck-scrape first and returns mapped { results }', async () => {
    mockDuckSearch.mockResolvedValueOnce({
      results: [
        { title: 'Result 1', url: 'https://example.com/1', description: 'desc-1' },
        { title: 'Result 2', url: 'https://example.com/2', description: 'desc-2' },
      ],
    });

    const result = await webSearch('openlander', { maxResults: 1 });

    expect(mockDuckSearch).toHaveBeenCalledWith('openlander', { safeSearch: 'moderate' });
    expect(result).toEqual({
      results: [{ title: 'Result 1', url: 'https://example.com/1', snippet: 'desc-1' }],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to DuckDuckGo Lite HTML parsing when duck-duck-scrape fails', async () => {
    mockDuckSearch.mockRejectedValueOnce(new Error('duck-duck-scrape down'));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<a rel="noopener" href="https://docs.example.com">Docs &amp; Guides</a><br/><span>Deploy &amp; monitor</span>',
    });

    const result = await webSearch('openlander docs', { maxResults: 5 });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      results: [
        {
          title: 'Docs & Guides',
          url: 'https://docs.example.com',
          snippet: 'Deploy & monitor',
        },
      ],
    });
  });

  it('returns empty { results } when both primary and fallback fail', async () => {
    mockDuckSearch.mockRejectedValueOnce(new Error('primary failed'));
    mockFetch.mockRejectedValueOnce(new Error('fallback failed'));

    const result = await webSearch('failure path');

    expect(result).toEqual({ results: [] });
  });

  it('returns empty { results } when primary is empty and fallback HTTP fails', async () => {
    mockDuckSearch.mockResolvedValueOnce({ results: [] });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    const result = await webSearch('no-results');

    expect(result).toEqual({ results: [] });
  });
});
