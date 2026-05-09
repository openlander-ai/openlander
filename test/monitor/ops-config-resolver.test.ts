import { describe, expect, it } from 'vitest';
import { resolveAutomationPolicy, isAutopilot } from '../../src/monitor/ops-config-resolver.js';
import {
  DEFAULT_OPS_CONFIG,
  DEFAULT_RECOVERY_AUTOMATION,
  type OpsConfig,
  type ProjectOpsOverride,
} from '../../src/monitor/ops-types.js';

describe('resolveAutomationPolicy', () => {
  it('returns DEFAULT_RECOVERY_AUTOMATION when no override provided', () => {
    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG);

    expect(policy).toEqual(DEFAULT_RECOVERY_AUTOMATION);
    expect(policy?.restart).toBe('auto');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('confirm');
  });

  it('returns null when recovery.enabled is false', () => {
    const config: OpsConfig = {
      ...DEFAULT_OPS_CONFIG,
      recovery: {
        ...DEFAULT_OPS_CONFIG.recovery,
        enabled: false,
      },
    };

    const policy = resolveAutomationPolicy(config);
    expect(policy).toBeNull();
  });

  it('applies global config override for single step', () => {
    const config: OpsConfig = {
      ...DEFAULT_OPS_CONFIG,
      recovery: {
        ...DEFAULT_OPS_CONFIG.recovery,
        automation: {
          ...DEFAULT_RECOVERY_AUTOMATION,
          restart: 'confirm',
        },
      },
    };

    const policy = resolveAutomationPolicy(config);

    expect(policy?.restart).toBe('confirm');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('confirm');
  });

  it('applies project override for single step', () => {
    const override: ProjectOpsOverride = {
      automation: {
        rollback: 'auto',
      },
    };

    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG, override);

    expect(policy?.restart).toBe('auto');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('auto');
  });

  it('project override supersedes global config', () => {
    const config: OpsConfig = {
      ...DEFAULT_OPS_CONFIG,
      recovery: {
        ...DEFAULT_OPS_CONFIG.recovery,
        automation: {
          ...DEFAULT_RECOVERY_AUTOMATION,
          restart: 'confirm',
          diagnosis: 'confirm',
        },
      },
    };

    const override: ProjectOpsOverride = {
      automation: {
        restart: 'auto',
      },
    };

    const policy = resolveAutomationPolicy(config, override);

    expect(policy?.restart).toBe('auto');
    expect(policy?.diagnosis).toBe('confirm');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('confirm');
  });

  it('handles multiple overrides at global level', () => {
    const config: OpsConfig = {
      ...DEFAULT_OPS_CONFIG,
      recovery: {
        ...DEFAULT_OPS_CONFIG.recovery,
        automation: {
          restart: 'confirm',
          diagnosis: 'confirm',
          apply_fixes: 'auto',
          rollback: 'auto',
        },
      },
    };

    const policy = resolveAutomationPolicy(config);

    expect(policy?.restart).toBe('confirm');
    expect(policy?.diagnosis).toBe('confirm');
    expect(policy?.apply_fixes).toBe('auto');
    expect(policy?.rollback).toBe('auto');
  });

  it('handles multiple overrides at project level', () => {
    const override: ProjectOpsOverride = {
      automation: {
        restart: 'confirm',
        apply_fixes: 'auto',
      },
    };

    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG, override);

    expect(policy?.restart).toBe('confirm');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('auto');
    expect(policy?.rollback).toBe('confirm');
  });

  it('ignores undefined values in global override', () => {
    const config: OpsConfig = {
      ...DEFAULT_OPS_CONFIG,
      recovery: {
        ...DEFAULT_OPS_CONFIG.recovery,
        automation: {
          restart: 'confirm',
          diagnosis: undefined as any,
          apply_fixes: 'confirm',
          rollback: 'confirm',
        },
      },
    };

    const policy = resolveAutomationPolicy(config);

    expect(policy?.restart).toBe('confirm');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('confirm');
  });

  it('ignores undefined values in project override', () => {
    const override: ProjectOpsOverride = {
      automation: {
        restart: 'confirm',
        diagnosis: undefined,
        apply_fixes: undefined,
        rollback: 'auto',
      },
    };

    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG, override);

    expect(policy?.restart).toBe('confirm');
    expect(policy?.diagnosis).toBe('auto');
    expect(policy?.apply_fixes).toBe('confirm');
    expect(policy?.rollback).toBe('auto');
  });

  it('handles empty project override object', () => {
    const override: ProjectOpsOverride = {};

    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG, override);

    expect(policy).toEqual(DEFAULT_RECOVERY_AUTOMATION);
  });

  it('handles undefined project override', () => {
    const policy = resolveAutomationPolicy(DEFAULT_OPS_CONFIG, undefined);

    expect(policy).toEqual(DEFAULT_RECOVERY_AUTOMATION);
  });
});

describe('isAutopilot', () => {
  it('returns true when all steps are auto', () => {
    const policy = {
      restart: 'auto' as const,
      diagnosis: 'auto' as const,
      apply_fixes: 'auto' as const,
      rollback: 'auto' as const,
    };

    expect(isAutopilot(policy)).toBe(true);
  });

  it('returns false when restart is confirm', () => {
    const policy = {
      restart: 'confirm' as const,
      diagnosis: 'auto' as const,
      apply_fixes: 'auto' as const,
      rollback: 'auto' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('returns false when diagnosis is confirm', () => {
    const policy = {
      restart: 'auto' as const,
      diagnosis: 'confirm' as const,
      apply_fixes: 'auto' as const,
      rollback: 'auto' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('returns false when apply_fixes is confirm', () => {
    const policy = {
      restart: 'auto' as const,
      diagnosis: 'auto' as const,
      apply_fixes: 'confirm' as const,
      rollback: 'auto' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('returns false when rollback is confirm', () => {
    const policy = {
      restart: 'auto' as const,
      diagnosis: 'auto' as const,
      apply_fixes: 'auto' as const,
      rollback: 'confirm' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('returns false when multiple steps are confirm', () => {
    const policy = {
      restart: 'confirm' as const,
      diagnosis: 'confirm' as const,
      apply_fixes: 'auto' as const,
      rollback: 'auto' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('returns false when all steps are confirm', () => {
    const policy = {
      restart: 'confirm' as const,
      diagnosis: 'confirm' as const,
      apply_fixes: 'confirm' as const,
      rollback: 'confirm' as const,
    };

    expect(isAutopilot(policy)).toBe(false);
  });

  it('works with DEFAULT_RECOVERY_AUTOMATION (should be false)', () => {
    expect(isAutopilot(DEFAULT_RECOVERY_AUTOMATION)).toBe(false);
  });
});
