/**
 * Health Check Type System
 *
 * Foundational type definitions for the health check refactor.
 * Used by probe-runner, profile-resolver, strategies, and monitors.
 * No implementation — pure TypeScript types and interfaces.
 */

/**
 * Whether a project is a web service (HTTP traffic) or a background worker.
 */
export type ProjectType = 'web' | 'worker';

/**
 * Strategy for health probing at runtime.
 */
export type HealthCheckStrategy = 'http' | 'tcp' | 'exec' | 'none';

/**
 * How to handle Docker native HEALTHCHECK when present.
 */
export type DockerHealthPolicy = 'prefer' | 'ignore';

/**
 * Configuration for a single health check probe.
 */
export interface HealthCheckConfig {
  /** Probe strategy to use */
  strategy: HealthCheckStrategy;
  /** HTTP path to check (strategy='http' only) */
  path?: string;
  /** Port override; defaults to container's assigned_port */
  port?: number;
  /** Command to execute inside container (strategy='exec' only) */
  command?: string[];
  /** Probe timeout in milliseconds */
  timeoutMs: number;
  /** Interval between probes in milliseconds */
  intervalMs: number;
  /** Number of consecutive failures before marking unhealthy */
  failureThreshold: number;
  /** Whether to prefer Docker native HEALTHCHECK when available */
  dockerHealthPolicy: DockerHealthPolicy;
}

/**
 * Full monitoring configuration derived from project_type and overrides.
 */
export interface MonitoringProfile {
  /** Project type (web or worker) */
  projectType: ProjectType;
  /** Whether this project should be routed via Traefik */
  exposeViaTraefik: boolean;
  /** Health check configuration */
  health: HealthCheckConfig;
}

/**
 * Result of a single probe execution.
 */
export interface ProbeResult {
  /** Whether the probe indicates a healthy state */
  healthy: boolean;
  /** Which mechanism produced this result */
  source: 'docker' | 'http' | 'tcp' | 'exec' | 'none';
  /** Human-readable error message when unhealthy */
  error?: string;
  /** Time taken for the probe in milliseconds */
  responseTimeMs?: number;
}

/**
 * Unified runtime failure signal for RecoveryCoordinator intake.
 */
export interface RuntimeSignal {
  /** Project ID associated with the failure */
  projectId: string;
  /** What kind of failure occurred */
  kind:
    | 'probe_failed'
    | 'container_died'
    | 'container_oom'
    | 'container_missing'
    | 'post_deploy_regression';
  /** Which component detected the failure */
  source: 'probe-monitor' | 'docker-events' | 'state-reconciler' | 'rollback-watcher';
  /** Container ID if applicable */
  containerId?: string;
  /** Error message or details */
  error?: string;
  /** Number of consecutive failures */
  failureCount?: number;
  /** Hint to recovery coordinator about preferred action */
  suggestedAction?: 'restart' | 'rollback';
}

/**
 * Interface for probe execution — abstracted for future multi-server support.
 * In-process implementation: LocalProbeRunner (src/health/probe-runner.ts)
 * Future: RemoteProbeRunner (Sentinel agent)
 */
export interface ProbeRunner {
  /**
   * Execute a single health check probe.
   * @param config Health check configuration
   * @param context Probe execution context
   * @returns Promise resolving to probe result
   */
  runProbe(config: HealthCheckConfig, context: ProbeContext): Promise<ProbeResult>;
}

/**
 * Context passed to probe execution.
 */
export interface ProbeContext {
  /** Project ID being probed */
  projectId: string;
  /** Container ID being probed */
  containerId: string;
  /** Assigned external port (used as default for HTTP/TCP probes) */
  assignedPort?: number;
}
