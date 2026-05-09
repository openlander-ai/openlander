/**
 * Parse .env file content into key-value pairs.
 *
 * Supports: KEY=VALUE, KEY="quoted", KEY='quoted', # comments,
 * empty lines, export KEY=VALUE, KEY= (empty value), duplicates (last wins).
 * Does NOT handle multiline values.
 */
export function parseEnvContent(text: string): Array<{ key: string; value: string }> {
  if (!text || !text.trim()) return [];

  const lines = text.split('\n');
  const result = new Map<string, string>();

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip `export ` prefix
    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.slice(7);
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result.set(key, value);
    }
  }

  return Array.from(result.entries()).map(([key, value]) => ({ key, value }));
}
