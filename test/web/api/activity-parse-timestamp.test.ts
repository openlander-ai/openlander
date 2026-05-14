/**
 * Regression: /api/activity was silently dropping every deploy_log row
 * because parseTimestamp couldn't parse Postgres `now()::text` output
 * (space-separated body + 2-digit timezone offset like `+00`). The user-
 * visible symptom was an empty Deployments tab and missing human deploys
 * in the activity feed even though the deploy_logs rows existed.
 */
import { describe, expect, it } from 'vitest';

import { parseTimestamp } from '../../../src/web/api/activity-routes.js';

describe('parseTimestamp', () => {
  it('parses Postgres now()::text (space body, 2-digit offset)', () => {
    const ms = parseTimestamp('2026-05-15 04:23:11.123456+00');
    expect(ms).toBe(Date.UTC(2026, 4, 15, 4, 23, 11, 123));
  });

  it('parses Postgres now()::text with non-zero offset', () => {
    // +09 => 04:23:11 local in +09 == 19:23:11 UTC of the previous day-ish;
    // assert via UTC conversion instead of hardcoding to keep timezone
    // arithmetic explicit.
    const expected = Date.UTC(2026, 4, 14, 19, 23, 11, 123);
    expect(parseTimestamp('2026-05-15 04:23:11.123456+09')).toBe(expected);
  });

  it('parses Postgres now()::text without microseconds', () => {
    expect(parseTimestamp('2026-05-15 04:23:11+00')).toBe(Date.UTC(2026, 4, 15, 4, 23, 11));
  });

  it('keeps ISO 8601 Z timestamps working', () => {
    expect(parseTimestamp('2026-05-15T04:23:11.123Z')).toBe(Date.UTC(2026, 4, 15, 4, 23, 11, 123));
  });

  it('keeps ISO 8601 with ±HH:MM offset working', () => {
    expect(parseTimestamp('2026-05-15T04:23:11.123+00:00')).toBe(
      Date.UTC(2026, 4, 15, 4, 23, 11, 123),
    );
  });

  it('accepts ISO 8601 with ±HHMM offset (no colon)', () => {
    expect(parseTimestamp('2026-05-15T04:23:11.123+0000')).toBe(
      Date.UTC(2026, 4, 15, 4, 23, 11, 123),
    );
  });

  it('treats legacy "YYYY-MM-DD HH:MM:SS" rows (no offset) as UTC', () => {
    expect(parseTimestamp('2026-05-15 04:23:11')).toBe(Date.UTC(2026, 4, 15, 4, 23, 11));
  });

  it('passes numeric epoch through', () => {
    const ms = Date.UTC(2026, 4, 15);
    expect(parseTimestamp(ms)).toBe(ms);
  });

  it('returns null for null / empty / unparseable input', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('   ')).toBeNull();
    expect(parseTimestamp('not-a-date')).toBeNull();
    expect(parseTimestamp(Number.NaN)).toBeNull();
  });
});
