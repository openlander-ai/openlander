import { describe, it, expect, beforeEach } from 'vitest';

import { JobManager } from '../src/pipeline/job-manager.js';
import type { JobPhase } from '../src/pipeline/job-manager.js';

describe('JobManager', () => {
  let jm: JobManager;

  beforeEach(() => {
    jm = new JobManager();
  });

  it('tracks a new job with queued phase', () => {
    jm.trackJob('p1', 'my-app');
    const status = jm.getStatus('p1');
    expect(status).toBeDefined();
    expect(status!.phase).toBe('queued');
    expect(status!.projectName).toBe('my-app');
    expect(status!.completedAt).toBeUndefined();
  });

  it('updates phase through the pipeline lifecycle', () => {
    jm.trackJob('p1', 'my-app');

    const phases: JobPhase[] = ['cloning', 'building', 'starting', 'done'];
    for (const phase of phases) {
      jm.updatePhase('p1', phase);
      expect(jm.getStatus('p1')!.phase).toBe(phase);
    }

    expect(jm.getStatus('p1')!.completedAt).toBeDefined();
  });

  it('sets completedAt on done', () => {
    jm.trackJob('p1', 'my-app');
    jm.updatePhase('p1', 'done');
    expect(jm.getStatus('p1')!.completedAt).toBeInstanceOf(Date);
  });

  it('sets completedAt and errorSummary on failed', () => {
    jm.trackJob('p1', 'my-app');
    jm.updatePhase('p1', 'failed', 'Dockerfile not found');
    const s = jm.getStatus('p1')!;
    expect(s.completedAt).toBeInstanceOf(Date);
    expect(s.errorSummary).toBe('Dockerfile not found');
  });

  it('ignores updatePhase for unknown project', () => {
    jm.updatePhase('nonexistent', 'building');
    expect(jm.getStatus('nonexistent')).toBeUndefined();
  });

  it('returns undefined for untracked project', () => {
    expect(jm.getStatus('nope')).toBeUndefined();
  });

  it('getActiveJobs filters out done and failed', () => {
    jm.trackJob('p1', 'app1');
    jm.trackJob('p2', 'app2');
    jm.trackJob('p3', 'app3');

    jm.updatePhase('p1', 'building');
    jm.updatePhase('p2', 'done');
    jm.updatePhase('p3', 'failed', 'err');

    const active = jm.getActiveJobs();
    expect(active).toHaveLength(1);
    expect(active[0]!.projectId).toBe('p1');
  });

  it('getStatuses returns all when no IDs given', () => {
    jm.trackJob('p1', 'a');
    jm.trackJob('p2', 'b');
    expect(jm.getStatuses()).toHaveLength(2);
  });

  it('getStatuses filters by IDs', () => {
    jm.trackJob('p1', 'a');
    jm.trackJob('p2', 'b');
    jm.trackJob('p3', 'c');
    const result = jm.getStatuses(['p1', 'p3']);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.projectId)).toEqual(['p1', 'p3']);
  });

  it('cleanup removes old completed jobs', () => {
    jm.trackJob('p1', 'old');
    jm.updatePhase('p1', 'done');
    const s = jm.getStatus('p1')!;
    // Backdate completedAt to 1 hour ago
    s.completedAt = new Date(Date.now() - 60 * 60 * 1000);

    jm.trackJob('p2', 'recent');
    jm.updatePhase('p2', 'done');

    jm.cleanup(30 * 60 * 1000);

    expect(jm.getStatus('p1')).toBeUndefined();
    expect(jm.getStatus('p2')).toBeDefined();
  });

  it('cleanup keeps active jobs regardless of age', () => {
    jm.trackJob('p1', 'building');
    jm.updatePhase('p1', 'building');

    jm.cleanup(0);

    expect(jm.getStatus('p1')).toBeDefined();
  });

  it('formatSummary returns empty string when no active jobs', () => {
    expect(jm.formatSummary()).toBe('');
  });

  it('formatSummary returns one-liner per active job', () => {
    jm.trackJob('p1', 'frontend');
    jm.trackJob('p2', 'backend');
    jm.updatePhase('p1', 'building');
    jm.updatePhase('p2', 'cloning');

    const summary = jm.formatSummary();
    expect(summary).toContain('frontend: building');
    expect(summary).toContain('backend: cloning');
  });

  it('tracks multiple concurrent jobs independently', () => {
    jm.trackJob('p1', 'svc-a');
    jm.trackJob('p2', 'svc-b');
    jm.trackJob('p3', 'svc-c');

    jm.updatePhase('p1', 'building');
    jm.updatePhase('p2', 'done');
    jm.updatePhase('p3', 'failed', 'timeout');

    expect(jm.getStatus('p1')!.phase).toBe('building');
    expect(jm.getStatus('p2')!.phase).toBe('done');
    expect(jm.getStatus('p3')!.phase).toBe('failed');
    expect(jm.getStatus('p3')!.errorSummary).toBe('timeout');
  });

  describe('Docker build step tracking', () => {
    it('updateBuildStep sets step, total, and desc fields', () => {
      jm.trackJob('p1', 'my-app');
      jm.updateBuildStep('p1', 3, 11, 'RUN pip install -r requirements.txt');

      const status = jm.getStatus('p1')!;
      expect(status.buildStep).toBe(3);
      expect(status.buildStepTotal).toBe(11);
      expect(status.buildStepDesc).toBe('RUN pip install -r requirements.txt');
    });

    it('updateBuildStep ignores unknown project', () => {
      jm.updateBuildStep('nonexistent', 1, 5, 'FROM node');
      expect(jm.getStatus('nonexistent')).toBeUndefined();
    });

    it('updateBuildStep overwrites previous step values', () => {
      jm.trackJob('p1', 'my-app');
      jm.updateBuildStep('p1', 1, 5, 'FROM node:22');
      jm.updateBuildStep('p1', 2, 5, 'WORKDIR /app');

      const status = jm.getStatus('p1')!;
      expect(status.buildStep).toBe(2);
      expect(status.buildStepDesc).toBe('WORKDIR /app');
    });

    it('parseDockerBuildStep parses standard Docker step format', () => {
      const line = 'Step 3/11 : RUN pip install -r requirements.txt';
      const result = JobManager.parseDockerBuildStep(line);

      expect(result).toEqual({
        step: 3,
        total: 11,
        desc: 'RUN pip install -r requirements.txt',
      });
    });

    it('parseDockerBuildStep parses FROM step', () => {
      const line = 'Step 1/5 : FROM node:22-alpine';
      const result = JobManager.parseDockerBuildStep(line);

      expect(result).toEqual({
        step: 1,
        total: 5,
        desc: 'FROM node:22-alpine',
      });
    });

    it('parseDockerBuildStep returns undefined for cache lines', () => {
      const line = ' ---> Using cache';
      const result = JobManager.parseDockerBuildStep(line);
      expect(result).toBeUndefined();
    });

    it('parseDockerBuildStep returns undefined for empty string', () => {
      const result = JobManager.parseDockerBuildStep('');
      expect(result).toBeUndefined();
    });

    it('parseDockerBuildStep returns undefined for BuildKit format', () => {
      const line = '#5 [stage-0 3/7] RUN apt-get update';
      const result = JobManager.parseDockerBuildStep(line);
      expect(result).toBeUndefined();
    });

    it('parseDockerBuildStep handles whitespace in description', () => {
      const line = 'Step 5/10 : RUN   npm   install   --legacy-peer-deps';
      const result = JobManager.parseDockerBuildStep(line);

      expect(result).toEqual({
        step: 5,
        total: 10,
        desc: 'RUN   npm   install   --legacy-peer-deps',
      });
    });

    it('build step fields are undefined when not set', () => {
      jm.trackJob('p1', 'my-app');
      const status = jm.getStatus('p1')!;

      expect(status.buildStep).toBeUndefined();
      expect(status.buildStepTotal).toBeUndefined();
      expect(status.buildStepDesc).toBeUndefined();
    });

    it('build step fields persist across phase changes', () => {
      jm.trackJob('p1', 'my-app');
      jm.updateBuildStep('p1', 5, 10, 'RUN npm build');
      jm.updatePhase('p1', 'building');

      const status = jm.getStatus('p1')!;
      expect(status.buildStep).toBe(5);
      expect(status.buildStepTotal).toBe(10);
      expect(status.buildStepDesc).toBe('RUN npm build');
    });
  });
});
