import { describe, it, expect } from 'vitest';
import {
  DeployPlan,
  DeployPlanStatus,
  DeployPlanComplexity,
  PlanStateMachine,
} from '../src/pipeline/deploy-plan/types.js';

describe('DeployPlanStatus type', () => {
  it('accepts valid status values', () => {
    const statuses: DeployPlanStatus[] = [
      'draft',
      'ready',
      'needs_input',
      'needs_approval',
      'executing',
      'completed',
      'failed',
      'rolled_back',
    ];
    expect(statuses).toHaveLength(8);
  });
});

describe('DeployPlanComplexity type', () => {
  it('accepts valid complexity values', () => {
    const complexities: DeployPlanComplexity[] = ['simple', 'standard', 'complex'];
    expect(complexities).toHaveLength(3);
  });
});

describe('DeployPlan interface', () => {
  it('has all required fields', () => {
    const plan: DeployPlan = {
      plan_id: 'plan-123',
      status: 'draft',
      complexity: 'simple',
      app: {
        name: 'my-app',
        source: {
          repo_url: 'https://github.com/user/repo',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      build: {
        dockerfile: 'Dockerfile',
        context: '.',
      },
      services: [],
      secrets: [],
      env: {
        auto: {},
        required: [],
        provided: {},
      },
      health: {
        path: '/health',
        retries: 3,
        interval_ms: 5000,
      },
      missing: [],
      warnings: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(plan.plan_id).toBe('plan-123');
    expect(plan.status).toBe('draft');
    expect(plan.complexity).toBe('simple');
    expect(plan.app.name).toBe('my-app');
    expect(plan.build.dockerfile).toBe('Dockerfile');
    expect(plan.services).toEqual([]);
    expect(plan.secrets).toEqual([]);
    expect(plan.env.auto).toEqual({});
    expect(plan.health.path).toBe('/health');
    expect(plan.missing).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('supports optional fields', () => {
    const plan: DeployPlan = {
      plan_id: 'plan-123',
      status: 'draft',
      complexity: 'simple',
      app: {
        name: 'my-app',
        source: {
          repo_url: 'https://github.com/user/repo',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      build: {
        dockerfile: 'Dockerfile',
        context: '.',
        target: 'production',
        generated_dockerfile: 'FROM node:20\n...',
      },
      services: [
        {
          type: 'postgresql',
          action: 'create',
          name: 'db',
          connect_via: 'DATABASE_URL',
        },
      ],
      secrets: [
        {
          name: 'API_KEY',
          mount_path: '/run/secrets/api_key',
          status: 'provided',
        },
      ],
      env: {
        auto: { PORT: '3000' },
        required: ['DATABASE_URL'],
        provided: { NODE_ENV: 'production' },
      },
      health: {
        path: '/health',
        retries: 3,
        interval_ms: 5000,
      },
      missing: ['DATABASE_URL'],
      warnings: ['No health check endpoint found'],
      dry_run_result: {
        build_success: true,
        image_id: 'sha256:abc123',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      project_id: 'proj-456',
      error_message: undefined,
    };

    expect(plan.build.target).toBe('production');
    expect(plan.build.generated_dockerfile).toBeDefined();
    expect(plan.services).toHaveLength(1);
    expect(plan.services[0].type).toBe('postgresql');
    expect(plan.secrets).toHaveLength(1);
    expect(plan.dry_run_result?.build_success).toBe(true);
    expect(plan.executed_at).toBeDefined();
    expect(plan.completed_at).toBeDefined();
    expect(plan.project_id).toBe('proj-456');
  });
});

describe('PlanStateMachine.canTransition', () => {
  it('allows draft → ready', () => {
    expect(PlanStateMachine.canTransition('draft', 'ready')).toBe(true);
  });

  it('allows draft → needs_input', () => {
    expect(PlanStateMachine.canTransition('draft', 'needs_input')).toBe(true);
  });

  it('allows needs_input → ready', () => {
    expect(PlanStateMachine.canTransition('needs_input', 'ready')).toBe(true);
  });

  it('allows needs_approval → ready (approval flips to ready in memory)', () => {
    expect(PlanStateMachine.canTransition('needs_approval', 'ready')).toBe(true);
  });

  it('rejects needs_approval → executing (an unapproved plan can never be persisted as executing)', () => {
    expect(PlanStateMachine.canTransition('needs_approval', 'executing')).toBe(false);
  });

  it('allows ready → executing', () => {
    expect(PlanStateMachine.canTransition('ready', 'executing')).toBe(true);
  });

  it('allows executing → completed', () => {
    expect(PlanStateMachine.canTransition('executing', 'completed')).toBe(true);
  });

  it('allows executing → failed', () => {
    expect(PlanStateMachine.canTransition('executing', 'failed')).toBe(true);
  });

  it('allows executing → rolled_back', () => {
    expect(PlanStateMachine.canTransition('executing', 'rolled_back')).toBe(true);
  });

  it('rejects ready → draft', () => {
    expect(PlanStateMachine.canTransition('ready', 'draft')).toBe(false);
  });

  it('rejects completed → executing', () => {
    expect(PlanStateMachine.canTransition('completed', 'executing')).toBe(false);
  });

  it('rejects failed → ready', () => {
    expect(PlanStateMachine.canTransition('failed', 'ready')).toBe(false);
  });

  it('rejects rolled_back → executing', () => {
    expect(PlanStateMachine.canTransition('rolled_back', 'executing')).toBe(false);
  });

  it('rejects draft → executing (must go through ready)', () => {
    expect(PlanStateMachine.canTransition('draft', 'executing')).toBe(false);
  });

  it('rejects draft → completed', () => {
    expect(PlanStateMachine.canTransition('draft', 'completed')).toBe(false);
  });

  it('rejects draft → failed', () => {
    expect(PlanStateMachine.canTransition('draft', 'failed')).toBe(false);
  });

  it('rejects draft → rolled_back', () => {
    expect(PlanStateMachine.canTransition('draft', 'rolled_back')).toBe(false);
  });

  it('rejects needs_input → executing', () => {
    expect(PlanStateMachine.canTransition('needs_input', 'executing')).toBe(false);
  });

  it('rejects needs_input → draft', () => {
    expect(PlanStateMachine.canTransition('needs_input', 'draft')).toBe(false);
  });

  it('rejects ready → needs_input', () => {
    expect(PlanStateMachine.canTransition('ready', 'needs_input')).toBe(false);
  });

  it('rejects executing → draft', () => {
    expect(PlanStateMachine.canTransition('executing', 'draft')).toBe(false);
  });

  it('rejects executing → ready', () => {
    expect(PlanStateMachine.canTransition('executing', 'ready')).toBe(false);
  });

  it('rejects executing → needs_input', () => {
    expect(PlanStateMachine.canTransition('executing', 'needs_input')).toBe(false);
  });

  it('rejects completed → draft', () => {
    expect(PlanStateMachine.canTransition('completed', 'draft')).toBe(false);
  });

  it('rejects completed → ready', () => {
    expect(PlanStateMachine.canTransition('completed', 'ready')).toBe(false);
  });

  it('rejects completed → failed', () => {
    expect(PlanStateMachine.canTransition('completed', 'failed')).toBe(false);
  });

  it('rejects completed → rolled_back', () => {
    expect(PlanStateMachine.canTransition('completed', 'rolled_back')).toBe(false);
  });

  it('rejects failed → draft', () => {
    expect(PlanStateMachine.canTransition('failed', 'draft')).toBe(false);
  });

  it('rejects failed → executing', () => {
    expect(PlanStateMachine.canTransition('failed', 'executing')).toBe(false);
  });

  it('rejects failed → completed', () => {
    expect(PlanStateMachine.canTransition('failed', 'completed')).toBe(false);
  });

  it('rejects rolled_back → draft', () => {
    expect(PlanStateMachine.canTransition('rolled_back', 'draft')).toBe(false);
  });

  it('rejects rolled_back → ready', () => {
    expect(PlanStateMachine.canTransition('rolled_back', 'ready')).toBe(false);
  });

  it('rejects rolled_back → completed', () => {
    expect(PlanStateMachine.canTransition('rolled_back', 'completed')).toBe(false);
  });

  it('rejects rolled_back → failed', () => {
    expect(PlanStateMachine.canTransition('rolled_back', 'failed')).toBe(false);
  });
});

describe('PlanStateMachine.transition', () => {
  const createBasePlan = (): DeployPlan => ({
    plan_id: 'plan-123',
    status: 'draft',
    complexity: 'simple',
    app: {
      name: 'my-app',
      source: {
        repo_url: 'https://github.com/user/repo',
        branch: 'main',
        commit_sha: 'abc123',
      },
    },
    build: {
      dockerfile: 'Dockerfile',
      context: '.',
    },
    services: [],
    secrets: [],
    env: {
      auto: {},
      required: [],
      provided: {},
    },
    health: {
      path: '/health',
      retries: 3,
      interval_ms: 5000,
    },
    missing: [],
    warnings: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  it('transitions draft → ready and updates status', () => {
    const plan = createBasePlan();
    const updated = PlanStateMachine.transition(plan, 'ready');

    expect(updated.status).toBe('ready');
    expect(updated.plan_id).toBe(plan.plan_id);
    expect(updated.updated_at).toBeDefined();
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(plan.updated_at).getTime(),
    );
  });

  it('transitions draft → needs_input', () => {
    const plan = createBasePlan();
    const updated = PlanStateMachine.transition(plan, 'needs_input');

    expect(updated.status).toBe('needs_input');
  });

  it('transitions needs_input → ready', () => {
    const plan = createBasePlan();
    plan.status = 'needs_input';
    const updated = PlanStateMachine.transition(plan, 'ready');

    expect(updated.status).toBe('ready');
  });

  it('transitions ready → executing', () => {
    const plan = createBasePlan();
    plan.status = 'ready';
    const updated = PlanStateMachine.transition(plan, 'executing');

    expect(updated.status).toBe('executing');
  });

  it('transitions executing → completed and sets completed_at', () => {
    const plan = createBasePlan();
    plan.status = 'executing';
    const updated = PlanStateMachine.transition(plan, 'completed');

    expect(updated.status).toBe('completed');
    expect(updated.completed_at).toBeDefined();
  });

  it('transitions executing → failed and sets error_message', () => {
    const plan = createBasePlan();
    plan.status = 'executing';
    const updated = PlanStateMachine.transition(plan, 'failed', 'Build failed: out of memory');

    expect(updated.status).toBe('failed');
    expect(updated.error_message).toBe('Build failed: out of memory');
  });

  it('transitions executing → rolled_back', () => {
    const plan = createBasePlan();
    plan.status = 'executing';
    const updated = PlanStateMachine.transition(plan, 'rolled_back');

    expect(updated.status).toBe('rolled_back');
  });

  it('throws on invalid transition ready → draft', () => {
    const plan = createBasePlan();
    plan.status = 'ready';

    expect(() => PlanStateMachine.transition(plan, 'draft')).toThrow(
      'Invalid transition: ready → draft',
    );
  });

  it('throws on invalid transition completed → executing', () => {
    const plan = createBasePlan();
    plan.status = 'completed';

    expect(() => PlanStateMachine.transition(plan, 'executing')).toThrow(
      'Invalid transition: completed → executing',
    );
  });

  it('throws on invalid transition failed → ready', () => {
    const plan = createBasePlan();
    plan.status = 'failed';

    expect(() => PlanStateMachine.transition(plan, 'ready')).toThrow(
      'Invalid transition: failed → ready',
    );
  });

  it('throws on invalid transition rolled_back → executing', () => {
    const plan = createBasePlan();
    plan.status = 'rolled_back';

    expect(() => PlanStateMachine.transition(plan, 'executing')).toThrow(
      'Invalid transition: rolled_back → executing',
    );
  });

  it('does not mutate original plan', () => {
    const plan = createBasePlan();
    const originalStatus = plan.status;
    const originalUpdatedAt = plan.updated_at;

    PlanStateMachine.transition(plan, 'ready');

    expect(plan.status).toBe(originalStatus);
    expect(plan.updated_at).toBe(originalUpdatedAt);
  });

  it('preserves all other fields during transition', () => {
    const plan = createBasePlan();
    plan.app.name = 'custom-app';
    plan.warnings = ['warning1', 'warning2'];

    const updated = PlanStateMachine.transition(plan, 'ready');

    expect(updated.app.name).toBe('custom-app');
    expect(updated.warnings).toEqual(['warning1', 'warning2']);
  });

  it('sets executed_at when transitioning to executing', () => {
    const plan = createBasePlan();
    plan.status = 'ready';
    const before = new Date();
    const updated = PlanStateMachine.transition(plan, 'executing');
    const after = new Date();

    expect(updated.executed_at).toBeDefined();
    if (updated.executed_at) {
      const executedTime = new Date(updated.executed_at);
      expect(executedTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(executedTime.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });
});
