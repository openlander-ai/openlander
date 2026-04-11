/**
 * Parse SQLite UTC timestamps that lack timezone qualifiers.
 *
 * SQLite CURRENT_TIMESTAMP stores as 'YYYY-MM-DD HH:MM:SS' (no T, no Z).
 * JavaScript new Date() treats this as LOCAL time, causing a 9-hour offset on KST servers.
 *
 * This utility detects the SQLite format and appends 'Z' to force UTC parsing.
 * If the timestamp is already ISO format (contains T or Z), it passes through as-is.
 *
 * @param timestamp - The timestamp string from the database
 * @returns Parsed Date object in UTC
 */
export function parseDBTimestamp(timestamp: string): Date {
  const trimmed = timestamp.trim();

  // Detect SQLite format: YYYY-MM-DD HH:MM:SS (no T, no Z)
  const sqliteLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

  // If it matches SQLite format, replace space with T and append Z for UTC
  const normalized = sqliteLike.test(trimmed) ? trimmed.replace(' ', 'T') + 'Z' : trimmed;

  return new Date(normalized);
}
