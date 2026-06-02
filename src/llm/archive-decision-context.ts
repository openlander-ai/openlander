import type { Database } from '../db/index.js';
import type { ToolDecisionContext } from './decision.js';

function readStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function resolveProject(db: Database, args: Record<string, unknown>) {
  const projectId = readStringArg(args, 'project_id') ?? readStringArg(args, 'projectId');
  if (projectId) {
    const project = await db.getProject(projectId);
    if (project) {
      return project;
    }
  }

  const projectName = readStringArg(args, 'project_name') ?? readStringArg(args, 'projectName');
  if (projectName) {
    return db.getProjectByName(projectName);
  }

  return undefined;
}

async function buildArchiveProjectContext(
  db: Database,
  args: Record<string, unknown>,
): Promise<ToolDecisionContext | undefined> {
  const project = await resolveProject(db, args);
  if (!project) {
    // Cannot resolve the target — fall back to the static HIGH default (gate).
    return undefined;
  }

  const [deployable, environments, managed] = await Promise.all([
    db.getDeployableForProject(project.id),
    db.getEnvironmentsByProject(project.id),
    db.getManagedServicesByGroup(project.id),
  ]);

  const productionEnv = environments.find((environment) => environment.type === 'production');
  const hasSignal = Boolean(productionEnv) || Boolean(deployable) || managed.length > 0;
  if (!hasSignal) {
    // No production environment, no deployable, no managed resource: the
    // production state is unknown. Fail safe to a human gate rather than
    // auto-approving an archive we cannot reason about.
    return { archive: { productionRunning: true } };
  }

  // Gate when the production workload is live OR any managed resource (e.g. a
  // database holding data) is still running, even if the app itself is stopped.
  const workloadRunning = productionEnv
    ? productionEnv.status === 'running'
    : deployable
      ? deployable.status === 'running'
      : false;
  const managedRunning = managed.some((service) => service.status === 'running');

  return { archive: { productionRunning: workloadRunning || managedRunning } };
}

async function buildArchiveServiceContext(
  db: Database,
  args: Record<string, unknown>,
): Promise<ToolDecisionContext | undefined> {
  const serviceId = readStringArg(args, 'service_id') ?? readStringArg(args, 'serviceId');
  if (!serviceId) {
    return undefined;
  }

  const service = await db.getService(serviceId);
  if (!service) {
    // Cannot resolve the target service — fall back to the HIGH default (gate).
    return undefined;
  }

  return { archive: { productionRunning: service.status === 'running' } };
}

/**
 * Build the archive approval context. Archive is a reversible cleanup, so it is
 * gated only when the target is a live production workload (or holds a running
 * managed resource). Non-production / stopped targets are auto-approved; an
 * unresolved or unknown target fails safe to the static HIGH default (gate).
 *
 * Returns `undefined` for non-archive tools and for unresolved targets so the
 * DecisionEngine falls back to its static risk defaults.
 */
export async function buildArchiveDecisionContext(
  db: Database,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolDecisionContext | undefined> {
  if (toolName === 'archive_project') {
    return buildArchiveProjectContext(db, args);
  }
  if (toolName === 'archive_service') {
    return buildArchiveServiceContext(db, args);
  }
  return undefined;
}
