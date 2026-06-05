import { describe, expect, it } from 'vitest';

import { inferEnvValueRequirement, validateEnvValue } from '../src/pipeline/env-requirements.js';

describe('env value requirements', () => {
  it('infers constraints for common app secrets without copyable fake values', () => {
    expect(inferEnvValueRequirement('STRIPE_API_KEY')).toMatchObject({
      kind: 'prefix',
      prefix: 'sk_',
      guidance: expect.stringContaining('real Stripe secret key'),
    });
    expect(inferEnvValueRequirement('EXCHANGE_API_KEY')).toMatchObject({
      kind: 'prefix',
      prefix: 'key_',
      guidance: expect.stringContaining('real key'),
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

    expect(
      validateEnvValue('JWT_SECRET', 'short', inferEnvValueRequirement('JWT_SECRET')),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_TOO_SHORT', severity: 'fail' })]);
  });

  it('blocks reserved/example URL hosts for required URL env vars', () => {
    expect(
      validateEnvValue(
        'EXCHANGE_API_URL',
        'https://api.example.com',
        inferEnvValueRequirement('EXCHANGE_API_URL'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_RESERVED_URL_HOST', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'EXCHANGE_API_URL',
        'https://api.exchange-example.org',
        inferEnvValueRequirement('EXCHANGE_API_URL'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_RESERVED_URL_HOST', severity: 'fail' })]);

    expect(
      validateEnvValue(
        'EXCHANGE_API_URL',
        'https://api.github.com',
        inferEnvValueRequirement('EXCHANGE_API_URL'),
      ),
    ).toEqual([]);
  });

  it('blocks obvious dummy/sample/test secrets even when their prefix looks valid', () => {
    expect(
      validateEnvValue(
        'EXCHANGE_API_KEY',
        'key_test_dummy',
        inferEnvValueRequirement('EXCHANGE_API_KEY'),
      ),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);

    expect(
      validateEnvValue('STRIPE_API_KEY', 'sk_live_sample', inferEnvValueRequirement('STRIPE_API_KEY')),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_PLACEHOLDER', severity: 'fail' })]);
  });

  it('infers integer requirements for numeric knobs', () => {
    expect(inferEnvValueRequirement('SMTP_PORT')).toMatchObject({
      kind: 'int',
    });
    expect(
      validateEnvValue('SMTP_PORT', 'abc', inferEnvValueRequirement('SMTP_PORT')),
    ).toEqual([expect.objectContaining({ code: 'ENV_VALUE_NOT_INTEGER', severity: 'fail' })]);
  });
});
