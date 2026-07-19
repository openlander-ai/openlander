import { describe, expect, it } from 'vitest';
import { deriveGroupStatusFromServices } from '../../src/db/repos/project.repo.js';

describe('deriveGroupStatusFromServices', () => {
  it('uses long-running Compose children instead of the portless stopped parent', () => {
    expect(
      deriveGroupStatusFromServices([
        { kind: 'compose', status: 'stopped', runtime_role: 'application' },
        { kind: 'compose-child', status: 'running', runtime_role: 'application' },
        { kind: 'compose-child', status: 'running', runtime_role: 'resource' },
        { kind: 'compose-child', status: 'stopped', runtime_role: 'job' },
      ]),
    ).toBe('running');
  });

  it('keeps Compose child errors visible while ignoring a normally stopped job', () => {
    expect(
      deriveGroupStatusFromServices([
        { kind: 'compose', status: 'stopped', runtime_role: 'application' },
        { kind: 'compose-child', status: 'running', runtime_role: 'application' },
        { kind: 'compose-child', status: 'error', runtime_role: 'resource' },
        { kind: 'compose-child', status: 'stopped', runtime_role: 'job' },
      ]),
    ).toBe('error');
  });
});
