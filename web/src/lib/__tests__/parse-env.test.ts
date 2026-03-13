import { describe, it, expect } from 'vitest';
import { parseEnvContent } from '../parse-env';

describe('parseEnvContent', () => {
  it('parses basic KEY=VALUE pairs', () => {
    const result = parseEnvContent('DB_HOST=localhost\nDB_PORT=5432');
    expect(result).toEqual([
      { key: 'DB_HOST', value: 'localhost' },
      { key: 'DB_PORT', value: '5432' },
    ]);
  });

  it('strips double quotes from values', () => {
    const result = parseEnvContent('API_KEY="sk-abc123"');
    expect(result).toEqual([{ key: 'API_KEY', value: 'sk-abc123' }]);
  });

  it('strips single quotes from values', () => {
    const result = parseEnvContent("SECRET='my-secret'");
    expect(result).toEqual([{ key: 'SECRET', value: 'my-secret' }]);
  });

  it('skips comment lines', () => {
    const result = parseEnvContent('# This is a comment\nKEY=value\n# Another comment');
    expect(result).toEqual([{ key: 'KEY', value: 'value' }]);
  });

  it('skips empty lines', () => {
    const result = parseEnvContent('A=1\n\n\nB=2\n');
    expect(result).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });

  it('strips export prefix', () => {
    const result = parseEnvContent('export DATABASE_URL=postgres://localhost/db');
    expect(result).toEqual([{ key: 'DATABASE_URL', value: 'postgres://localhost/db' }]);
  });

  it('handles empty values', () => {
    const result = parseEnvContent('EMPTY_VAR=');
    expect(result).toEqual([{ key: 'EMPTY_VAR', value: '' }]);
  });

  it('preserves spaces in unquoted values', () => {
    const result = parseEnvContent('GREETING=hello world');
    expect(result).toEqual([{ key: 'GREETING', value: 'hello world' }]);
  });

  it('handles values with equals signs', () => {
    const result = parseEnvContent('CONNECTION=host=localhost;port=5432');
    expect(result).toEqual([{ key: 'CONNECTION', value: 'host=localhost;port=5432' }]);
  });

  it('uses last-write-wins for duplicate keys', () => {
    const result = parseEnvContent('KEY=first\nKEY=second\nKEY=third');
    expect(result).toEqual([{ key: 'KEY', value: 'third' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseEnvContent('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseEnvContent('   \n  \n  ')).toEqual([]);
  });

  it('skips lines without equals sign', () => {
    const result = parseEnvContent('VALID=yes\nINVALID_LINE\nALSO_VALID=true');
    expect(result).toEqual([
      { key: 'VALID', value: 'yes' },
      { key: 'ALSO_VALID', value: 'true' },
    ]);
  });

  it('returns empty array for comments-only input', () => {
    const result = parseEnvContent('# comment 1\n# comment 2');
    expect(result).toEqual([]);
  });

  it('trims whitespace from keys and values', () => {
    const result = parseEnvContent('  KEY  =  value  ');
    expect(result).toEqual([{ key: 'KEY', value: 'value' }]);
  });

  it('handles export with quoted values', () => {
    const result = parseEnvContent('export API_KEY="sk-12345"');
    expect(result).toEqual([{ key: 'API_KEY', value: 'sk-12345' }]);
  });

  it('handles a realistic .env file', () => {
    const input = `# Database
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
REDIS_URL="redis://localhost:6379"

# API Keys
export STRIPE_KEY='sk_test_abc123'
export OPENAI_KEY=sk-proj-xyz

# Feature Flags
ENABLE_DARK_MODE=true
DEBUG=`;

    const result = parseEnvContent(input);
    expect(result).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://user:pass@localhost:5432/mydb' },
      { key: 'REDIS_URL', value: 'redis://localhost:6379' },
      { key: 'STRIPE_KEY', value: 'sk_test_abc123' },
      { key: 'OPENAI_KEY', value: 'sk-proj-xyz' },
      { key: 'ENABLE_DARK_MODE', value: 'true' },
      { key: 'DEBUG', value: '' },
    ]);
  });
});
