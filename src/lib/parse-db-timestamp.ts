/**
 * Parse legacy SQL UTC timestamps that lack timezone qualifiers.
 *
 * Older OpenLander rows used 'YYYY-MM-DD HH:MM:SS' strings (no T, no Z).
 * JavaScript new Date() treats this as LOCAL time, causing a 9-hour offset on KST servers.
 *
 * This utility detects that legacy format and appends 'Z' to force UTC parsing.
 * If the timestamp is already ISO format (contains T or Z), it passes through as-is.
 *
 * @param timestamp - The timestamp string from the database
 * @returns Parsed Date object in UTC
 */
export function parseDBTimestamp(timestamp: string): Date {
  const trimmed = timestamp.trim();

  // Detect legacy no-timezone format: YYYY-MM-DD HH:MM:SS
  const legacyNoTimezone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

  // If it matches the legacy format, replace space with T and append Z for UTC.
  const normalized = legacyNoTimezone.test(trimmed) ? trimmed.replace(' ', 'T') + 'Z' : trimmed;

  return new Date(normalized);
}
