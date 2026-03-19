import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { scanDockerfileArgs, scanEnvFile, scanEnvTemplate } from '../../src/lib/env-parser.js';

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

describe('env-parser', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('parses .env entries and marks required/default values correctly', () => {
    mockReadFileSync.mockReturnValue('API_KEY=\nSECRET_TOKEN=my_secret\n');

    const entries = scanEnvFile('/repo/.env.example', '.env.example');

    expect(entries).toEqual([
      {
        key: 'API_KEY',
        source: '.env.example',
        required: true,
        default: undefined,
      },
      {
        key: 'SECRET_TOKEN',
        source: '.env.example',
        required: false,
        default: 'my_secret',
      },
    ]);
  });

  it('does not allow newline consumption after equals due to [ \t]* pattern', () => {
    mockReadFileSync.mockReturnValue('API_KEY=\nSECRET_TOKEN=my_secret\n');

    const entries = scanEnvFile('/repo/.env.example', '.env.example');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ key: 'API_KEY', required: true, default: undefined });
    expect(entries[1]).toMatchObject({
      key: 'SECRET_TOKEN',
      required: false,
      default: 'my_secret',
    });
  });

  it('parses Dockerfile ARG declarations with and without defaults', () => {
    mockReadFileSync.mockReturnValue('ARG NODE_VERSION=18\nARG API_KEY\n');

    const entries = scanDockerfileArgs('/repo', 'Dockerfile');

    expect(entries).toEqual([
      {
        key: 'NODE_VERSION',
        source: 'Dockerfile ARG (Dockerfile)',
        required: false,
        default: '18',
      },
      {
        key: 'API_KEY',
        source: 'Dockerfile ARG (Dockerfile)',
        required: true,
        default: undefined,
      },
    ]);
  });

  it('returns empty arrays for empty env and Dockerfile content', () => {
    mockReadFileSync.mockReturnValue('');

    expect(scanEnvFile('/repo/.env', '.env')).toEqual([]);
    expect(scanDockerfileArgs('/repo', 'Dockerfile')).toEqual([]);
  });

  it('detects .env.example, .env.sample, and .env.template template files', () => {
    mockExistsSync.mockImplementation((path: string) => {
      return (
        path === '/repo/services/.env.example' ||
        path === '/repo/apps/.env.sample' ||
        path === '/repo/jobs/.env.template'
      );
    });

    mockReadFileSync.mockImplementation((path: string) => {
      if (path === '/repo/services/.env.example') {
        return 'SERVICE_KEY=\n';
      }
      if (path === '/repo/apps/.env.sample') {
        return 'APP_KEY=sample\n';
      }
      if (path === '/repo/jobs/.env.template') {
        return 'JOB_TOKEN=\n';
      }
      return '';
    });

    const fromExample = scanEnvTemplate('/repo', 'services/.env');
    const fromSample = scanEnvTemplate('/repo', 'apps/.env');
    const fromTemplate = scanEnvTemplate('/repo', 'jobs/.env');

    expect(fromExample).toEqual([
      {
        key: 'SERVICE_KEY',
        source: 'services/.env → services/.env.example',
        required: true,
        default: undefined,
      },
    ]);

    expect(fromSample).toEqual([
      {
        key: 'APP_KEY',
        source: 'apps/.env → apps/.env.sample',
        required: false,
        default: 'sample',
      },
    ]);

    expect(fromTemplate).toEqual([
      {
        key: 'JOB_TOKEN',
        source: 'jobs/.env → jobs/.env.template',
        required: true,
        default: undefined,
      },
    ]);
  });
});
