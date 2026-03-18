import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../src/db/index.js';

describe('Deploy Plans DB', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-plan-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createDeployPlan', () => {
    it('creates a deploy plan with all fields', () => {
      const planJson = JSON.stringify({
        steps: [{ name: 'build', command: 'docker build' }],
        complexity: 'high',
      });

      const created = db.createDeployPlan({
        id: 'plan-1',
        projectName: 'my-app',
        status: 'pending',
        complexity: 'high',
        planJson,
        commitSha: 'abc123def456',
      });

      expect(created.id).toBe('plan-1');
      expect(created.project_name).toBe('my-app');
      expect(created.status).toBe('pending');
      expect(created.complexity).toBe('high');
      expect(created.plan_json).toBe(planJson);
      expect(created.commit_sha).toBe('abc123def456');
      expect(created.created_at).toBeDefined();
      expect(created.updated_at).toBeDefined();
      expect(created.executed_at).toBeNull();
      expect(created.completed_at).toBeNull();
      expect(created.error_message).toBeNull();
    });

    it('creates a deploy plan with minimal fields', () => {
      const planJson = JSON.stringify({ steps: [] });

      const created = db.createDeployPlan({
        id: 'plan-2',
        status: 'pending',
        planJson,
      });

      expect(created.id).toBe('plan-2');
      expect(created.project_name).toBeNull();
      expect(created.status).toBe('pending');
      expect(created.complexity).toBeNull();
      expect(created.plan_json).toBe(planJson);
      expect(created.commit_sha).toBeNull();
    });

    it('preserves JSON structure in plan_json', () => {
      const complexPlan = {
        steps: [
          { name: 'clone', command: 'git clone' },
          { name: 'build', command: 'docker build', timeout: 3600 },
        ],
        metadata: {
          version: '1.0',
          tags: ['production', 'critical'],
        },
      };
      const planJson = JSON.stringify(complexPlan);

      db.createDeployPlan({
        id: 'plan-3',
        status: 'pending',
        planJson,
      });

      const retrieved = db.getDeployPlan('plan-3');
      expect(retrieved).toBeDefined();
      const parsedPlan = JSON.parse(retrieved!.plan_json);
      expect(parsedPlan).toEqual(complexPlan);
    });
  });

  describe('getDeployPlan', () => {
    it('retrieves a deploy plan by ID', () => {
      const planJson = JSON.stringify({ steps: [] });
      db.createDeployPlan({
        id: 'plan-1',
        projectName: 'app-1',
        status: 'pending',
        planJson,
      });

      const retrieved = db.getDeployPlan('plan-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('plan-1');
      expect(retrieved!.project_name).toBe('app-1');
    });

    it('returns undefined for non-existent plan', () => {
      const result = db.getDeployPlan('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateDeployPlan', () => {
    beforeEach(() => {
      const planJson = JSON.stringify({ steps: [] });
      db.createDeployPlan({
        id: 'plan-1',
        projectName: 'app-1',
        status: 'pending',
        complexity: 'low',
        planJson,
      });
    });

    it('updates status field', () => {
      db.updateDeployPlan('plan-1', { status: 'executing' });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.status).toBe('executing');
    });

    it('updates complexity field', () => {
      db.updateDeployPlan('plan-1', { complexity: 'high' });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.complexity).toBe('high');
    });

    it('updates error_message field', () => {
      db.updateDeployPlan('plan-1', { errorMessage: 'Build failed: timeout' });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.error_message).toBe('Build failed: timeout');
    });

    it('updates executed_at timestamp', () => {
      const now = new Date().toISOString();
      db.updateDeployPlan('plan-1', { executedAt: now });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.executed_at).toBe(now);
    });

    it('updates completed_at timestamp', () => {
      const now = new Date().toISOString();
      db.updateDeployPlan('plan-1', { completedAt: now });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.completed_at).toBe(now);
    });

    it('updates multiple fields at once', () => {
      const now = new Date().toISOString();
      db.updateDeployPlan('plan-1', {
        status: 'completed',
        completedAt: now,
        errorMessage: null,
      });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.status).toBe('completed');
      expect(updated!.completed_at).toBe(now);
      expect(updated!.error_message).toBeNull();
    });
  });

  describe('updateDeployPlanStatus', () => {
    beforeEach(() => {
      const planJson = JSON.stringify({ steps: [] });
      db.createDeployPlan({
        id: 'plan-1',
        projectName: 'app-1',
        status: 'pending',
        planJson,
      });
    });

    it('updates status and sets updated_at', () => {
      db.updateDeployPlanStatus('plan-1', 'executing');

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.status).toBe('executing');
      expect(updated!.updated_at).toBeDefined();
    });

    it('transitions through multiple statuses', () => {
      db.updateDeployPlanStatus('plan-1', 'executing');
      let plan = db.getDeployPlan('plan-1');
      expect(plan!.status).toBe('executing');

      db.updateDeployPlanStatus('plan-1', 'completed');
      plan = db.getDeployPlan('plan-1');
      expect(plan!.status).toBe('completed');

      db.updateDeployPlanStatus('plan-1', 'failed');
      plan = db.getDeployPlan('plan-1');
      expect(plan!.status).toBe('failed');
    });
  });

  describe('listDeployPlans', () => {
    beforeEach(() => {
      const planJson = JSON.stringify({ steps: [] });
      db.createDeployPlan({
        id: 'plan-1',
        projectName: 'app-1',
        status: 'pending',
        planJson,
      });
      db.createDeployPlan({
        id: 'plan-2',
        projectName: 'app-2',
        status: 'completed',
        planJson,
      });
      db.createDeployPlan({
        id: 'plan-3',
        projectName: 'app-1',
        status: 'failed',
        planJson,
      });
    });

    it('lists all plans ordered by created_at desc', () => {
      const plans = db.listDeployPlans();
      expect(plans).toHaveLength(3);
      // Most recent first
      expect(plans[0]!.id).toBe('plan-3');
      expect(plans[1]!.id).toBe('plan-2');
      expect(plans[2]!.id).toBe('plan-1');
    });

    it('filters plans by projectName', () => {
      const plans = db.listDeployPlans('app-1');
      expect(plans).toHaveLength(2);
      expect(plans.every((p) => p.project_name === 'app-1')).toBe(true);
    });

    it('returns empty array for non-existent project', () => {
      const plans = db.listDeployPlans('nonexistent');
      expect(plans).toHaveLength(0);
    });
  });

  describe('getLatestPlanForProject', () => {
    beforeEach(() => {
      const planJson = JSON.stringify({ steps: [] });
      db.createDeployPlan({
        id: 'plan-1',
        projectName: 'app-1',
        status: 'pending',
        planJson,
      });
      // Small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }
      db.createDeployPlan({
        id: 'plan-2',
        projectName: 'app-1',
        status: 'completed',
        planJson,
      });
    });

    it('returns the most recent plan for a project', () => {
      const latest = db.getLatestPlanForProject('app-1');
      expect(latest).toBeDefined();
      expect(latest!.id).toBe('plan-2');
      expect(latest!.status).toBe('completed');
    });

    it('returns undefined for project with no plans', () => {
      const latest = db.getLatestPlanForProject('nonexistent');
      expect(latest).toBeUndefined();
    });
  });

  describe('JSON round-trip', () => {
    it('preserves complex nested JSON structures', () => {
      const originalPlan = {
        version: '1.0',
        steps: [
          {
            id: 'step-1',
            name: 'clone',
            command: 'git clone',
            timeout: 300,
            retries: 3,
            env: {
              GIT_DEPTH: '1',
              GIT_SINGLE_BRANCH: 'true',
            },
          },
          {
            id: 'step-2',
            name: 'build',
            command: 'docker build',
            timeout: 3600,
            buildArgs: {
              NODE_ENV: 'production',
              BUILD_DATE: '2024-01-01',
            },
          },
        ],
        metadata: {
          complexity: 'high',
          estimatedDuration: 3900,
          tags: ['production', 'critical', 'monitored'],
          author: 'deploy-engine',
        },
      };

      const planJson = JSON.stringify(originalPlan);
      db.createDeployPlan({
        id: 'plan-complex',
        projectName: 'complex-app',
        status: 'pending',
        planJson,
      });

      const retrieved = db.getDeployPlan('plan-complex');
      expect(retrieved).toBeDefined();

      const parsedPlan = JSON.parse(retrieved!.plan_json);
      expect(parsedPlan).toEqual(originalPlan);
      expect(parsedPlan.steps).toHaveLength(2);
      expect(parsedPlan.steps[0]!.env.GIT_DEPTH).toBe('1');
      expect(parsedPlan.metadata.tags).toContain('critical');
    });
  });

  describe('Timestamps', () => {
    it('sets created_at and updated_at on creation', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.created_at).toBeDefined();
      expect(created.updated_at).toBeDefined();
      expect(created.created_at).toBeTruthy();
      expect(created.updated_at).toBeTruthy();
    });

    it('keeps created_at unchanged on update', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      const originalCreatedAt = created.created_at;

      // Small delay
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }

      db.updateDeployPlan('plan-1', { status: 'executing' });

      const updated = db.getDeployPlan('plan-1');
      expect(updated!.created_at).toBe(originalCreatedAt);
    });
  });

  describe('Null fields', () => {
    it('allows null project_name', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.project_name).toBeNull();
    });

    it('allows null complexity', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.complexity).toBeNull();
    });

    it('allows null commit_sha', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.commit_sha).toBeNull();
    });

    it('allows null error_message', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.error_message).toBeNull();
    });

    it('allows null executed_at and completed_at', () => {
      const planJson = JSON.stringify({ steps: [] });
      const created = db.createDeployPlan({
        id: 'plan-1',
        status: 'pending',
        planJson,
      });

      expect(created.executed_at).toBeNull();
      expect(created.completed_at).toBeNull();
    });
  });
});
