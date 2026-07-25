import { ArtifactValidationError } from '../errors.js';

export interface NormalizedJUnitReport {
  format: 'junit';
  status: 'passed' | 'failed';
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  durationSeconds: number | null;
  summary: string;
}

function numericAttribute(attributes: string, name: string): number {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attributes);
  if (!match?.[1]) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Parses only aggregate JUnit attributes. It deliberately does not expand XML
 * entities or build a DOM, keeping CI report normalization non-executable.
 */
export function parseJUnitReport(xml: string): NormalizedJUnitReport {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ArtifactValidationError('JUnit reports cannot contain DTD or entity declarations.');
  }
  const root = /<testsuites?\b([^>]*)>/i.exec(xml);
  if (!root) {
    throw new ArtifactValidationError('JUnit report does not contain a testsuite root element.');
  }

  const rootAttributes = root[1] ?? '';
  let tests = numericAttribute(rootAttributes, 'tests');
  let failures = numericAttribute(rootAttributes, 'failures');
  let errors = numericAttribute(rootAttributes, 'errors');
  let skipped = numericAttribute(rootAttributes, 'skipped');
  let durationSeconds = numericAttribute(rootAttributes, 'time');

  if (/^<testsuites\b/i.test(root[0]) && tests === 0) {
    tests = 0;
    failures = 0;
    errors = 0;
    skipped = 0;
    durationSeconds = 0;
    for (const suite of xml.matchAll(/<testsuite\b([^>]*)>/gi)) {
      const attributes = suite[1] ?? '';
      tests += numericAttribute(attributes, 'tests');
      failures += numericAttribute(attributes, 'failures');
      errors += numericAttribute(attributes, 'errors');
      skipped += numericAttribute(attributes, 'skipped');
      durationSeconds += numericAttribute(attributes, 'time');
    }
  }

  const failed = failures + errors > 0;
  const duration = durationSeconds > 0 ? durationSeconds : null;
  const summary =
    `JUnit: ${String(tests)} test(s), ${String(failures)} failure(s), ` +
    `${String(errors)} error(s), ${String(skipped)} skipped` +
    (duration === null ? '' : `, ${duration.toFixed(3)}s`);

  return {
    format: 'junit',
    status: failed ? 'failed' : 'passed',
    tests,
    failures,
    errors,
    skipped,
    durationSeconds: duration,
    summary,
  };
}
