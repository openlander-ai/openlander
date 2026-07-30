import { describe, expect, it } from 'vitest';

import { inferEnvValueRequirement, validateEnvValue } from '../src/pipeline/env-requirements.js';

describe('env value requirements', () => {
  it('infers constraints for common app secrets without copyable fake values', () => {
    expect(inferEnvValueRequirement('STRIPE_API_KEY')).toMatchObject({
      kind: 'prefix',
      prefix: 'sk_',
      guidance: expect.stringContaining('real Stripe secret key'),
    });
    expect(inferEnvValueRequirement('API_KEY')).toMatchObject({
      kind: 'secret',
      guidance: expect.stringContaining('real secret'),
    });
    expect(inferEnvValueRequirement('JWT_SECRET')).toMatchObject({
      kind: 'minlen',
      min: 16,
      guidance: expect.stringContaining('real secret'),
    });
  });

  it('blocks invalid prefix and too-short required values before deploy execution', () => {
    expect(
      validateEnvValue('STRIPE_API_KEY', 'placeholder', inferEnvValueRequirement('STRIPE_API_KEY')),
    ).toEqual([
      expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' }),
      expect.objectContaining({ code: 'ENV_VALUE_PREFIX_MISMATCH', severity: 'fail' }),
    ]);

    expect(validateEnvValue('JWT_SECRET', 'short', inferEnvValueRequirement('JWT_SECRET'))).toEqual(
      [expect.objectContaining({ code: 'ENV_VALUE_TOO_SHORT', severity: 'fail' })],
    );
  });

  it('blocks reserved/example URL hosts for required URL env vars', () => {
    expect(
      validateEnvValue('API_URL', 'https://api.example.com', inferEnvValueRequirement('API_URL')),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_RESERVED_URL_HOST', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'API_URL',
        'https://api.exchange-example.org',
        inferEnvValueRequirement('API_URL'),
      ),
    ).toEqual([]);

    expect(
      validateEnvValue('API_URL', 'https://api.github.com', inferEnvValueRequirement('API_URL')),
    ).toEqual([]);
  });

  it('allows origin-relative URLs only for browser-public env vars', () => {
    expect(
      validateEnvValue(
        'NEXT_PUBLIC_API_BASE_URL',
        '/backend',
        inferEnvValueRequirement('NEXT_PUBLIC_API_BASE_URL'),
      ),
    ).toEqual([]);
    expect(validateEnvValue('API_URL', '/backend', inferEnvValueRequirement('API_URL'))).toEqual([
      expect.objectContaining({ code: 'ENV_VALUE_INVALID_URL', severity: 'fail' }),
    ]);
    expect(
      validateEnvValue(
        'NEXT_PUBLIC_API_BASE_URL',
        '//example.test/backend',
        inferEnvValueRequirement('NEXT_PUBLIC_API_BASE_URL'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_INVALID_URL', severity: 'fail' })]);
  });

  it('blocks obvious dummy/sample/test secrets even when their prefix looks valid', () => {
    expect(validateEnvValue('API_KEY', 'test_secret', inferEnvValueRequirement('API_KEY'))).toEqual(
      [expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })],
    );

    expect(
      validateEnvValue(
        'STRIPE_API_KEY',
        'sk_live_sample_secret',
        inferEnvValueRequirement('STRIPE_API_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);
  });

  it('blocks copied example secrets that satisfy basic shape checks', () => {
    expect(
      validateEnvValue(
        'API_KEY',
        ['key', 'supersecret'].join('_'),
        inferEnvValueRequirement('API_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'STRIPE_API_KEY',
        ['sk', 'live', 'supersecret'].join('_'),
        inferEnvValueRequirement('STRIPE_API_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'S3_ACCESS_KEY',
        'AKIAIOSFODNN7EXAMPLE',
        inferEnvValueRequirement('S3_ACCESS_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'S3_SECRET_KEY',
        'wJalrXUtnFEMIK7mJQ',
        inferEnvValueRequirement('S3_SECRET_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'STRIPE_API_KEY',
        'sk_abcdef123RealLookingKey',
        inferEnvValueRequirement('STRIPE_API_KEY'),
      ),
    ).toEqual([]);

    expect(
      validateEnvValue(
        'S3_SECRET_KEY',
        'realSecretWith123456InsideButNotAnExampleToken',
        inferEnvValueRequirement('S3_SECRET_KEY'),
      ),
    ).toEqual([]);
  });

  it('blocks reserved/example hosts for required host env vars', () => {
    expect(inferEnvValueRequirement('SMTP_HOST')).toMatchObject({
      kind: 'host',
      trustedSourceRequired: true,
    });

    expect(
      validateEnvValue('SMTP_HOST', 'smtp.example.com', inferEnvValueRequirement('SMTP_HOST')),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_RESERVED_HOST', severity: 'fail' })]);

    expect(
      validateEnvValue('SMTP_HOST', 'smtp.sendgrid.net', inferEnvValueRequirement('SMTP_HOST')),
    ).toEqual([]);

    expect(
      validateEnvValue('SMTP_HOST', 'demo.acme.io', inferEnvValueRequirement('SMTP_HOST')),
    ).toEqual([]);
  });

  it('requires trusted provenance for user-owned external env in deploy-plan inline input', () => {
    expect(inferEnvValueRequirement('APP_BASE_URL')).toMatchObject({
      kind: 'url',
    });
    expect(inferEnvValueRequirement('S3_BUCKET')).toMatchObject({
      kind: 'secret',
      trustedSourceRequired: true,
    });

    expect(
      validateEnvValue(
        'S3_BUCKET',
        'ledgerly-production-bucket',
        inferEnvValueRequirement('S3_BUCKET'),
        true,
        { trustedSource: false },
      ),
    ).toEqual([
      expect.objectContaining({ code: 'ENV_VALUE_UNTRUSTED_EXTERNAL', severity: 'fail' }),
    ]);

    expect(
      validateEnvValue(
        'S3_BUCKET',
        'ledgerly-production-bucket',
        inferEnvValueRequirement('S3_BUCKET'),
        true,
        { trustedSource: true },
      ),
    ).toEqual([]);

    expect(
      validateEnvValue(
        'DATABASE_URL',
        'postgres://postgres:postgres@postgres:5432/app',
        inferEnvValueRequirement('DATABASE_URL'),
        true,
        { trustedSource: false },
      ),
    ).toEqual([]);
  });

  it('allows self URLs with demo/test labels because they may be real preview routes', () => {
    expect(
      validateEnvValue(
        'APP_BASE_URL',
        'https://ledgerly-demo.openlander.app',
        inferEnvValueRequirement('APP_BASE_URL'),
      ),
    ).toEqual([]);
  });

  it('hard-fails provided optional values that are placeholder-like or structurally invalid', () => {
    expect(
      validateEnvValue(
        'OPTIONAL_SECRET',
        'placeholder',
        inferEnvValueRequirement('OPTIONAL_SECRET'),
        false,
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'OPTIONAL_API_URL',
        'https://api.example.com',
        inferEnvValueRequirement('OPTIONAL_API_URL'),
        false,
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_RESERVED_URL_HOST', severity: 'fail' })]);

    expect(
      validateEnvValue('SMTP_PORT', 'abc', inferEnvValueRequirement('SMTP_PORT'), false),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_NOT_INTEGER', severity: 'fail' })]);
  });

  it('infers integer requirements for numeric knobs', () => {
    expect(inferEnvValueRequirement('SMTP_PORT')).toMatchObject({
      kind: 'int',
    });
    expect(validateEnvValue('SMTP_PORT', 'abc', inferEnvValueRequirement('SMTP_PORT'))).toEqual([
      expect.objectContaining({ code: 'ENV_VALUE_NOT_INTEGER', severity: 'fail' }),
    ]);
  });
});
