import { describe, expect, it } from 'vitest';

import {
  deliveryManifestSha256,
  parseDeliveryManifest,
  resolveManifestReportPath,
} from '../../src/delivery/manifest.js';

const validManifest = `
version: 1
runner:
  image: node:22
  timeout_seconds: 600
checks:
  - key: unit
    gate: qa
    command: [npm, test, --, --run]
    report:
      path: reports/junit.xml
      format: junit
`;

describe('Delivery manifest', () => {
  it('parses a strict versioned manifest and preserves argv commands', () => {
    expect(parseDeliveryManifest(validManifest)).toMatchObject({
      version: 1,
      runner: { image: 'node:22', timeout_seconds: 600 },
      checks: [
        {
          key: 'unit',
          gate: 'qa',
          command: ['npm', 'test', '--', '--run'],
          report: { path: 'reports/junit.xml', format: 'junit' },
        },
      ],
    });
  });

  it('hashes the exact manifest bytes', () => {
    expect(deliveryManifestSha256(Buffer.from(validManifest))).toMatch(/^[a-f0-9]{64}$/);
    expect(deliveryManifestSha256(Buffer.from(validManifest))).not.toBe(
      deliveryManifestSha256(Buffer.from(`${validManifest}\n`)),
    );
  });

  it('rejects duplicate checks, shell strings, unknown fields, and escaping reports', () => {
    expect(() =>
      parseDeliveryManifest(validManifest.replace('key: unit', 'key: unit\n  - key: unit')),
    ).toThrow();
    expect(() =>
      parseDeliveryManifest(validManifest.replace('[npm, test, --, --run]', 'npm test')),
    ).toThrow();
    expect(() => parseDeliveryManifest(`${validManifest}unknown: true\n`)).toThrow();
    expect(() =>
      parseDeliveryManifest(validManifest.replace('reports/junit.xml', '../secret')),
    ).toThrow();
  });

  it('resolves report paths under the cloned repository only', () => {
    expect(resolveManifestReportPath('/tmp/repo', 'reports/junit.xml')).toBe(
      '/tmp/repo/reports/junit.xml',
    );
    expect(() => resolveManifestReportPath('/tmp/repo', '../../etc/passwd')).toThrow();
  });
});
