/**
 * OpsAgent Type System
 *
 * All type definitions for the OpsAgent module.
 * No implementation — pure TypeScript types and interfaces.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type IncidentStatus = 'open' | 'active' | 'resolved' | 'escalated';
export type RecoveryStepType =
  | 'restart'
  | 'healthcheck'
  | 'diagnosis'
  | 'fix'
  | 'rollback'
  | 'escalate';
export type RecoveryStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'pending_approval';

export type RecoveryStepMode = 'auto' | 'confirm';
export type ConfigurableRecoveryStep = 'restart' | 'diagnosis' | 'apply_fixes' | 'rollback';
export type RecoveryAutomationPolicy = Record<ConfigurableRecoveryStep, RecoveryStepMode>;

export interface ProjectOpsOverride {
  automation?: Partial<RecoveryAutomationPolicy>;
}

export interface RecoveryConfig {
  enabled: boolean;
  automation: RecoveryAutomationPolicy;
}

export interface OpsAlert {
  severity: AlertSeverity;
  project: { id: string; name: string };
  event_type: string;
  title: string;
  description: string;
  context: Record<string, unknown>;
  suggestion: string | null;
  actions_taken: string[];
  incident_id: string | null;
  timestamp: number;
}

export interface OpsEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface OpsRecoveryStep {
  step: RecoveryStepType;
  status: RecoveryStepStatus;
  started_at: number;
  completed_at: number | null;
  result: string | null;
}

export interface OpsConfig {
  enabled: boolean;
  recovery: RecoveryConfig;
  auto_restart: boolean; // Derived from recovery.enabled for frontend compatibility
  auto_cleanup: boolean;
  drift_detection: boolean;
  production_only: boolean;
  thresholds: {
    disk_cleanup_percent: number; // default 80
    recovery_max_per_day: number; // default 5
    alert_dedup_minutes: number; // default 15
    digest_time: string; // default "09:00"
  };
  channels: {
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
      to: string[];
    };
  };
}

export interface CircuitBreakerConfig {
  max_failures: number; // default 5
  window_hours: number; // default 24
  half_open_probe_interval_ms: number; // default 3600000 (1h)
}

export const DEFAULT_RECOVERY_AUTOMATION: RecoveryAutomationPolicy = {
  restart: 'auto',
  diagnosis: 'auto',
  apply_fixes: 'confirm',
  rollback: 'confirm',
};

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  enabled: true,
  automation: DEFAULT_RECOVERY_AUTOMATION,
};

export const DEFAULT_OPS_CONFIG: OpsConfig = {
  enabled: true,
  recovery: DEFAULT_RECOVERY_CONFIG,
  auto_restart: true,
  auto_cleanup: true,
  drift_detection: true,
  production_only: true,
  thresholds: {
    disk_cleanup_percent: 80,
    recovery_max_per_day: 5,
    alert_dedup_minutes: 15,
    digest_time: '09:00',
  },
  channels: {},
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  max_failures: 5,
  window_hours: 24,
  half_open_probe_interval_ms: 3_600_000,
};
