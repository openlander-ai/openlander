import { describe, expect, it } from 'vitest';

import {
  buildLogLinesFromBlob,
  deployStatusToOutcome,
  normalizeDeployLogPhase,
} from '../../src/web/api/deploy-log-source.js';

describe('deploy log source helpers', () => {
  it('maps persisted bracket prefixes onto frontend phase ids', () => {
    const lines = buildLogLinesFromBlob(
      [
        '[clone] Cloning repository',
        '[pull] Pulling base image',
        '[image] Detected EXPOSE port 3000',
        '[dockerfile] Found Dockerfile',
        '[build] #1 DONE 0.0s',
        '[tag] openlander/app:latest',
        '[run] Started container',
        '[health] Passed',
        '[connectivity] Local probe passed',
      ].join('\n'),
    );

    expect(lines.map((line) => line.phase)).toEqual([
      'clone',
      'image_pull',
      'image_pull',
      'build',
      'build',
      'container_start',
      'container_start',
      'healthcheck_wait',
      'healthcheck_wait',
    ]);
    expect(lines[0]).toMatchObject({
      prefix: 'clone',
      payload: 'Cloning repository',
    });
  });

  it('preserves unknown prefixes while falling back to build phase', () => {
    const [line] = buildLogLinesFromBlob('[pending-fix] Applied patch');

    expect(line).toEqual({
      phase: 'build',
      prefix: 'pending-fix',
      payload: 'Applied patch',
    });
  });

  it('trims arbitrary whitespace after bracket prefixes', () => {
    const lines = buildLogLinesFromBlob('[clone]  Cloning\n[run]\tStarting');

    expect(lines).toEqual([
      {
        phase: 'clone',
        prefix: 'clone',
        payload: 'Cloning',
      },
      {
        phase: 'container_start',
        prefix: 'run',
        payload: 'Starting',
      },
    ]);
  });

  it('treats raw Docker output as build/info and handles CRLF plus empty lines', () => {
    const lines = buildLogLinesFromBlob(
      '#1 [internal] load build definition from Dockerfile\r\n\r\n#2 DONE 0.1s\r\n',
    );

    expect(lines).toEqual([
      {
        phase: 'build',
        prefix: 'info',
        payload: '#1 [internal] load build definition from Dockerfile',
      },
      {
        phase: 'build',
        prefix: 'info',
        payload: '#2 DONE 0.1s',
      },
    ]);
  });

  it('normalizes legacy phase aliases and cancelled terminal outcomes', () => {
    expect(normalizeDeployLogPhase('image-pull')).toBe('image_pull');
    expect(normalizeDeployLogPhase('healthcheck wait')).toBe('healthcheck_wait');
    expect(normalizeDeployLogPhase('unknown')).toBe('build');
    expect(deployStatusToOutcome('cancelled')).toBe('cancelled');
  });
});
