import type { DetectedServiceType } from '../../lib/infra-analyzer.js';

/**
 * Deployment plan status lifecycle.
 * - draft: Initial state, plan created but not validated
 * - ready: Plan validated and ready for execution
 * - needs_input: Plan requires user input (e.g., missing secrets)
 * - executing: Plan is currently being executed
 * - completed: Plan executed successfully
 * - failed: Plan execution failed
 * - rolled_back: Plan was rolled back after execution
 */
export type DeployPlanStatus =
  | 'draft'
  | 'ready'
  | 'needs_input'
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
  /** Action to take: create new or reuse existing */
  action: 'create' | 'reuse';
  /** Optional service name */
  name?: string;
  /** Environment variable or connection string name */
  connect_via: string;
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

/**
 * Environment variable configuration.
 */
export interface PlanEnv {
  /** Auto-detected environment variables */
  auto: Record<string, string>;
  /** Required environment variables */
  required: string[];
  /** User-provided environment variables */
  provided: Record<string, string>;
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

/**
 * Complete deployment plan structure.
 */
export interface DeployPlan {
  /** Unique plan identifier */
  plan_id: string;
  /** Current status in the lifecycle */
  status: DeployPlanStatus;
  /** Complexity classification */
  complexity: DeployPlanComplexity;
  /** Application information */
  app: {
    /** Application name */
    name: string;
    /** Source repository information */
    source: {
      /** Repository URL */
      repo_url: string;
      /** Branch to deploy */
      branch: string;
      /** Commit SHA */
      commit_sha: string;
    };
  };
  /** Build configuration */
  build: {
    /** Dockerfile path */
    dockerfile: string;
    /** Build context directory */
    context: string;
    /** Optional build target (for multi-stage builds) */
    target?: string;
    /** Generated Dockerfile content if auto-generated */
    generated_dockerfile?: string;
  };
  /** Services to provision or reuse */
  services: PlanService[];
  /** Secrets required by the application */
  secrets: PlanSecret[];
  /** Environment variable configuration */
  env: PlanEnv;
  /** Health check configuration */
  health: PlanHealth;
  /** Missing items that need to be provided */
  missing: string[];
  /** Warnings about the plan */
  warnings: string[];
  /** Dry run result if plan was validated */
  dry_run_result?: DryRunResult;
  /** Timestamp when plan was created */
  created_at: string;
  /** Timestamp when plan was last updated */
  updated_at: string;
  /** Timestamp when plan execution started */
  executed_at?: string;
  /** Timestamp when plan execution completed */
  completed_at?: string;
  /** Associated project ID */
  project_id?: string;
  /** Error message if plan failed */
  error_message?: string;
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
      draft: ['ready', 'needs_input'],
      needs_input: ['ready'],
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
