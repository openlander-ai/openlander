import { describe, expect, it } from 'vitest';

import { derivePhaseStatus } from '../logRows';
import type { LogEntry } from '../logScripts';

// Minimal LogEntry helper — only `phase` is read by derivePhaseStatus,
// but the type requires the full shape so we fill the rest with stubs.
function line(phase: LogEntry['phase']): LogEntry {
  return { phase, prefix: 'info', payload: '' };
}

describe('derivePhaseStatus', () => {
  it('marks trailing silent phases as skipped on success (no HEALTHCHECK case)', () => {
    // Lines stop at container_start; healthcheck_wait never emits any
    // event. The pipeline still succeeds — the Health pip should not
    // stay perpetually pending, it should be `skipped`.
    const lines = [line('clone'), line('build'), line('container_create'), line('container_start')];
    const status = derivePhaseStatus(lines, 'success');
    expect(status.container_start).toBe('done');
    expect(status.healthcheck_wait).toBe('skipped');
  });

  it('marks earlier silent phases as skipped on success (cached image_pull case)', () => {
    // image_pull is silent because the image layers were cached; we
    // still went through clone → build → … Previously this collapsed
    // image_pull to `done`, which lied about a step that did not run.
    const lines = [line('clone'), line('build'), line('container_create'), line('container_start')];
    const status = derivePhaseStatus(lines, 'success');
    expect(status.clone).toBe('done');
    expect(status.image_pull).toBe('skipped');
    expect(status.build).toBe('done');
  });

  it('leaves trailing pending phases untouched on failure', () => {
    // Build failed at the build phase; container_create / start /
    // healthcheck were never reached. They must stay `pending` (not
    // `skipped`) because the pipeline did not finish.
    const lines = [line('clone'), line('build')];
    const status = derivePhaseStatus(lines, 'fail');
    expect(status.build).toBe('failed');
    expect(status.container_create).toBe('pending');
    expect(status.container_start).toBe('pending');
    expect(status.healthcheck_wait).toBe('pending');
  });

  it('returns all-pending while the build is still streaming (no outcome yet)', () => {
    // Mid-build: outcome is null. The currently emitting phase should
    // be `active`, the rest `pending` — `skipped` is reserved for
    // post-success bookkeeping.
    const lines = [line('clone'), line('build')];
    const status = derivePhaseStatus(lines, null);
    expect(status.clone).toBe('done');
    expect(status.build).toBe('active');
    expect(status.container_create).toBe('pending');
    expect(status.healthcheck_wait).toBe('pending');
  });
});
