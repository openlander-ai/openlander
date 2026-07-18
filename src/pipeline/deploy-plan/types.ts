import type { DetectedServiceType } from '../../lib/infra-analyzer.js';
import type { EnvValueIssue, EnvValueRequirement } from '../env-requirements.js';

/**
 * Deployment plan status lifecycle.
 * - draft: Initial state, plan created but not validated
 * - ready: Plan validated and ready for execution
 * - needs_input: Plan requires user input (e.g., missing secrets)
 * - needs_approval: Plan proposes auto-provisioning safe managed resources and
 *   requires explicit approval before execution
 * - executing: Plan is currently being executed
 * - completed: Plan executed successfully
 * - failed: Plan execution failed
 * - rolled_back: Plan was rolled back after execution
 */
export type DeployPlanStatus =
  | 'draft'
  | 'ready'
  | 'needs_input'
  | 'needs_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

/**
 * Deployment complexity classification.
 * - simple: Single container, no services, minimal config
 * - standard: Multiple services or moderate complexity
 * - complex: Many services, custom networking, advanced config
 */
export type DeployPlanComplexity = 'simple' | 'standard' | 'complex';

/**
 * Service configuration in the deployment plan.
 */
export interface PlanService {
  /** Service type (postgresql, mysql, redis, mongodb) */
  type: DetectedServiceType;
  /**
   * Legacy/advisory routing hint: 'create' = new dependency, 'reuse' = existing
   * service. Do NOT route on `action` alone — read `resolution` and `approval`.
   * An item can be action:'create' yet resolution:'compose_service' or
   * 'needs_user_input' (e.g. a not_auto_creatable type), which OpenLander will
   * not provision as a managed create.
   */
  action: 'create' | 'reuse';
  /** Optional service name */
  name?: string;
  /** Existing service id when action is reuse */
  service_id?: string;
  /** Environment variable or connection string name */
  connect_via: string;
  /**
   * How this service is satisfied. Metadata classification only — does not
   * change execution behavior.
   * - existing_project_service: a reusable Database/Cache resource already in the project
   * - proposed_project_service: a Database/Cache resource the plan proposes creating
   * - compose_service: the dependency is declared in the compose stack
   * - needs_user_input: requires the user to supply the connection
   */
  resolution?:
    | 'existing_project_service'
    | 'proposed_project_service'
    | 'compose_service'
    | 'needs_user_input';
  /** Detection evidence (dependency name, env var, schema.prisma:provider, etc.) */
  reason?: string;
  /**
   * Approval classification for this resource type. Metadata only — does not
   * gate execution.
   * - safe_resource: stateless/standard managed datastore (postgres, mysql, redis, mongo)
   * - explicit_resource: requires explicit user opt-in (e.g. object storage)
   * - not_auto_creatable: cannot be auto-provisioned by the plan engine
   */
  approval?: 'safe_resource' | 'explicit_resource' | 'not_auto_creatable';
}

/**
 * Secret configuration in the deployment plan.
 */
export interface PlanSecret {
  /** Secret name */
  name: string;
  /** Mount path in container */
  mount_path: string;
  /** Status: provided by user or missing */
  status: 'provided' | 'missing';
}

export interface PlanEnvEntry {
  key: string;
  source: string;
  required: boolean;
  default?: string;
  requirement?: EnvValueRequirement;
}

export interface PlanEnv {
  auto: Record<string, string>;
  required: string[];
  provided: Record<string, string>;
  trusted?: string[];
  detected: PlanEnvEntry[];
  issues?: EnvValueIssue[];
}

/**
 * Health check configuration.
 */
export interface PlanHealth {
  /** Health check endpoint path */
  path: string;
  /** Number of retries before marking unhealthy */
  retries: number;
  /** Interval between health checks in milliseconds */
  interval_ms: number;
}

/**
 * Dry run result from plan validation.
 */
export interface DryRunResult {
  /** Whether the build succeeded */
  build_success: boolean;
  /** Built image ID if successful */
  image_id?: string;
  /** Build errors if failed */
  errors?: string[];
}

export interface PlanBuildService {
  name: string;
  runtime_role?: 'application' | 'job' | 'resource';
  dockerfile?: string;
  port?: number;
  host_ports?: string[];
  image?: string;
  depends_on?: string[];
  internal_url?: string;
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
}

export interface DeployPlan {
  plan_id: string;
  status: DeployPlanStatus;
  complexity: DeployPlanComplexity;
  app: {
    name: string;
    source: {
      repo_url: string;
      branch: string;
      commit_sha: string;
      git_credential_id?: string;
      image_url?: string;
    };
  };
  build: {
    method: 'dockerfile' | 'compose' | 'image';
    dockerfile: string;
    context: string;
    target?: string;
    generated_dockerfile?: string;
    compose_file?: string;
    compose_profiles?: string[];
    selected_services?: string[];
    compose_services?: PlanBuildService[];
    traffic_service?: string;
    traffic_service_candidates?: string[];
    dockerfiles_found?: string[];
  };
  environment?: 'production' | 'development';
  production?: boolean;
  services: PlanService[];
  secrets: PlanSecret[];
  env: PlanEnv;
  health: PlanHealth;
  missing: string[];
  warnings: string[];
  dry_run_result?: DryRunResult;
  created_at: string;
  updated_at: string;
  executed_at?: string;
  completed_at?: string;
  project_id?: string;
  target_project_id?: string;
  error_message?: string;
  internal_url?: string;
  internal_url_note?: string;
}

/**
 * State machine for managing DeployPlan transitions.
 * Enforces valid state transitions and updates plan metadata.
 */
export const PlanStateMachine = {
  /**
   * Check if a transition from one status to another is valid.
   * @param from Current status
   * @param to Target status
   * @returns true if transition is allowed, false otherwise
   */
  canTransition(from: DeployPlanStatus, to: DeployPlanStatus): boolean {
    // Valid transitions map
    const validTransitions: Record<DeployPlanStatus, DeployPlanStatus[]> = {
      draft: ['ready', 'needs_input', 'needs_approval'],
      needs_input: ['ready'],
      // needs_approval -> ready only; the approval -> ready step is in-memory.
      // needs_approval -> executing is intentionally NOT an edge so an
      // unapproved plan can never be persisted as executing.
      needs_approval: ['ready'],
      ready: ['executing'],
      executing: ['completed', 'failed', 'rolled_back'],
      completed: [],
      failed: [],
      rolled_back: [],
    };

    return validTransitions[from].includes(to);
  },

  /**
   * Transition a plan to a new status.
   * Returns a new plan object with updated status and metadata.
   * @param plan Current plan
   * @param newStatus Target status
   * @param errorMessage Optional error message for failed transitions
   * @returns New plan with updated status
   * @throws Error if transition is invalid
   */
  transition(plan: DeployPlan, newStatus: DeployPlanStatus, errorMessage?: string): DeployPlan {
    if (!this.canTransition(plan.status, newStatus)) {
      throw new Error(`Invalid transition: ${plan.status} → ${newStatus}`);
    }

    const now = new Date().toISOString();
    const updated: DeployPlan = {
      ...plan,
      status: newStatus,
      updated_at: now,
    };

    // Set executed_at when transitioning to executing
    if (newStatus === 'executing') {
      updated.executed_at = now;
    }

    // Set completed_at when transitioning to completed
    if (newStatus === 'completed') {
      updated.completed_at = now;
    }

    // Set error_message when transitioning to failed
    if (newStatus === 'failed' && errorMessage) {
      updated.error_message = errorMessage;
    }

    return updated;
  },
};
