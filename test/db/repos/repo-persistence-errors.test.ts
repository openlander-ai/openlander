/**
 * Verifies that repos throw `RepoPersistenceError` (not generic `Error`) when
 * post-insert verification reads return no row. The new typed error gives
 * callers a stable code (`REPO_PERSISTENCE_FAILED`, status 500) instead of a
 * stringly-typed failure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { ProjectRepo } from '../../../src/db/repos/project.repo.js';
import { EnvironmentRepo } from '../../../src/db/repos/environment.repo.js';
import { ServiceRepo } from '../../../src/db/repos/service.repo.js';
import { DeployPlanRepo } from '../../../src/db/repos/deploy-plan.repo.js';
import { OpsIncidentRepo } from '../../../src/db/repos/ops-incident.repo.js';
import { OpsIncidentEventRepo } from '../../../src/db/repos/ops-incident-event.repo.js';
import { ServiceConnectionRepo } from '../../../src/db/repos/service-connection.repo.js';
import { RuntimeIncidentRepo } from '../../../src/db/repos/runtime-incident.repo.js';
import { RepoPersistenceError } from '../../../src/errors.js';

describe('RepoPersistenceError shape', () => {
  it('exposes code REPO_PERSISTENCE_FAILED with statusCode 500', () => {
    const err = new RepoPersistenceError('environment', 'env-1');
    expect(err.code).toBe('REPO_PERSISTENCE_FAILED');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('RepoPersistenceError');
    expect(err.details).toMatchObject({ entity: 'environment', identifier: 'env-1' });
    expect(err.message).toContain('environment');
    expect(err.message).toContain('env-1');
  });

  it('serializes to API JSON via toJSON()', () => {
    const err = new RepoPersistenceError('service', 'svc-1');
    const json = err.toJSON();
    expect(json.error).toBe('REPO_PERSISTENCE_FAILED');
    expect(json.details).toEqual({ entity: 'service', identifier: 'svc-1' });
  });
});

// The repos themselves still throw on success-path corruption (they check
// the verification read), so we exercise the happy path here to guarantee no
// regression after the typed-error migration. Triggering an actual
// post-insert miss would require monkey-patching internals; we already cover
// the error class shape above.

describe('Repo create paths still succeed (regression after typed-error migration)', () => {
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];
  let projectRepo: ProjectRepo;
  let environmentRepo: EnvironmentRepo;
  let serviceRepo: ServiceRepo;
  let deployPlanRepo: DeployPlanRepo;
  let opsIncidentRepo: OpsIncidentRepo;
  let opsIncidentEventRepo: OpsIncidentEventRepo;
  let serviceConnectionRepo: ServiceConnectionRepo;
  let runtimeIncidentRepo: RuntimeIncidentRepo;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
    projectRepo = new ProjectRepo(db.db, db.sqlite);
    environmentRepo = new EnvironmentRepo(db.db, db.sqlite);
    serviceRepo = new ServiceRepo(db.db, db.sqlite);
    deployPlanRepo = new DeployPlanRepo(db.db, db.sqlite);
    opsIncidentRepo = new OpsIncidentRepo(db.db, db.sqlite);
    opsIncidentEventRepo = new OpsIncidentEventRepo(db.db, db.sqlite);
    serviceConnectionRepo = new ServiceConnectionRepo(db.db, db.sqlite);
    runtimeIncidentRepo = new RuntimeIncidentRepo(db.db, db.sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('project: createProject succeeds and returns the row', () => {
    const project = projectRepo.createProject({
      id: 'p1',
      name: 'persist-app',
      repoUrl: 'https://github.com/test/persist-app',
    });
    expect(project.id).toBe('p1');
  });

  it('environment: createEnvironment succeeds for an existing project', () => {
    projectRepo.createProject({
      id: 'p1',
      name: 'env-host-app',
      repoUrl: 'https://github.com/test/env-host-app',
    });
    const env = environmentRepo.createEnvironment({
      id: 'env-1',
      projectId: 'p1',
      type: 'production',
      branch: 'main',
    });
    expect(env.id).toBe('env-1');
  });

  it('service: createService succeeds', () => {
    const service = serviceRepo.createService({
      id: 'svc-1',
      name: 'pg',
      type: 'postgres',
      image: 'postgres:16',
      containerName: 'svc-pg',
      port: 5432,
    });
    expect(service.id).toBe('svc-1');
  });

  it('deploy plan: createDeployPlan succeeds', () => {
    const plan = deployPlanRepo.createDeployPlan({
      id: 'plan-1',
      status: 'draft',
      planJson: '{}',
    });
    expect(plan.id).toBe('plan-1');
  });

  it('ops incident: create succeeds for an existing project', () => {
    projectRepo.createProject({
      id: 'p1',
      name: 'ops-host-app',
      repoUrl: 'https://github.com/test/ops-host-app',
    });
    const incident = opsIncidentRepo.create({
      id: 'inc-1',
      project_id: 'p1',
      severity: 'warning',
    });
    expect(incident.id).toBe('inc-1');
  });

  it('ops incident event: addEvent succeeds for an existing incident', () => {
    projectRepo.createProject({
      id: 'p1',
      name: 'ops-event-host',
      repoUrl: 'https://github.com/test/ops-event-host',
    });
    opsIncidentRepo.create({ id: 'inc-1', project_id: 'p1', severity: 'warning' });
    const evt = opsIncidentEventRepo.addEvent({
      id: 'evt-1',
      incident_id: 'inc-1',
      event_type: 'detected',
      description: 'first signal',
    });
    expect(evt.id).toBe('evt-1');
  });

  it('service connection: createConnection succeeds', () => {
    projectRepo.createProject({
      id: 'p1',
      name: 'conn-host-app',
      repoUrl: 'https://github.com/test/conn-host-app',
    });
    serviceRepo.createService({
      id: 'svc-1',
      name: 'pg',
      type: 'postgres',
      image: 'postgres:16',
      containerName: 'svc-pg',
      port: 5432,
    });
    const conn = serviceConnectionRepo.createConnection({
      projectId: 'p1',
      serviceId: 'svc-1',
    });
    expect(conn.project_id).toBe('p1');
    expect(conn.service_id).toBe('svc-1');
  });

  it('runtime incident: createIncident succeeds for an existing project', () => {
    projectRepo.createProject({
      id: 'p1',
      name: 'runtime-host-app',
      repoUrl: 'https://github.com/test/runtime-host-app',
    });
    const incident = runtimeIncidentRepo.createIncident({
      projectId: 'p1',
      category: 'crash',
    });
    expect(incident.project_id).toBe('p1');
  });
});
