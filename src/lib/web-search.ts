import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('web-search');

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  results: SearchResult[];
}

export interface WebSearchOptions {
  maxResults?: number;
}

export async function webSearch(
  query: string,
  options?: WebSearchOptions,
): Promise<WebSearchResponse> {
  const maxResults = options?.maxResults ?? 10;

  try {
    try {
      const results = await searchWithDuckDuckScrape(query, maxResults);
      if (results.length > 0) {
        logger.debug(
          { query, resultCount: results.length },
          'Web search succeeded with duck-duck-scrape',
        );
        return { results };
      }
    } catch (primaryError) {
      logger.debug(
        {
          query,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        'Primary provider (duck-duck-scrape) failed, trying fallback',
      );
    }

    const results = await searchWithDuckDuckGoLite(query, maxResults);
    if (results.length > 0) {
      logger.debug(
        { query, resultCount: results.length },
        'Web search succeeded with DuckDuckGo Lite fallback',
      );
      return { results };
    }

    logger.warn({ query }, 'Web search returned no results from both providers');
    return { results: [] };
  } catch (error) {
    logger.error(
      { query, error: error instanceof Error ? error.message : String(error) },
      'Web search failed completely',
    );
    return { results: [] };
  }
}

async function searchWithDuckDuckScrape(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const duckDuckScrape = await import('duck-duck-scrape');
  const search = duckDuckScrape.search as (
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<{ results?: Array<{ title?: string; url?: string; description?: string }> }>;

  const response = await search(query, { safeSearch: 'moderate' });

  if (!response.results || response.results.length === 0) {
    return [];
  }

  return response.results.slice(0, maxResults).map((result) => ({
    title: result.title ?? '',
    url: result.url ?? '',
    snippet: result.description ?? '',
  }));
}

async function searchWithDuckDuckGoLite(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status.toString()}`);
    }

    const html = await response.text();
    const results = parseSearchResults(html, maxResults);

    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  const resultPattern =
    /<a\s+rel="noopener"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<br\s*\/>\s*<span[^>]*>([^<]*)<\/span>/g;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const title = match[2];
    const snippet = match[3] ?? '';

    if (url && title && !url.includes('duckduckgo.com')) {
      results.push({
        title: decodeHtmlEntities(title.trim()),
        url: decodeHtmlEntities(url.trim()),
        snippet: decodeHtmlEntities(snippet.trim()),
      });
    }
  }

  return results;
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };

  return text.replace(/&[a-z]+;/gi, (entity) => entities[entity] ?? entity);
}
