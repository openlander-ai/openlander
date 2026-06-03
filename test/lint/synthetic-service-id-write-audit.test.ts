import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function methodBody(source: string, methodName: string): string {
  const nameIndex = source.indexOf(methodName);
  expect(nameIndex, `Expected to find ${methodName}`).toBeGreaterThanOrEqual(0);
  const signatureEnd = source.indexOf('):', nameIndex);
  expect(signatureEnd, `Expected ${methodName} to have a return type`).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', signatureEnd);
  expect(openBrace, `Expected ${methodName} to have a body`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, index + 1);
      }
    }
  }

  throw new Error(`Could not extract body for ${methodName}`);
}

describe('synthetic service id write audit', () => {
  it('keeps first-Application deploy ordering ahead of service-scoped writes', () => {
    const source = readSource('src/pipeline/deploy-core.ts');
    const body = methodBody(source, 'private async deployInner');

    const ensureIndex = body.indexOf('await this.ensureFirstApplicationService');
    expect(ensureIndex).toBeGreaterThanOrEqual(0);

    for (const writeCall of ['this.db.createEnvironment', 'this.deployEnvironment']) {
      const writeIndex = body.indexOf(writeCall);
      expect(writeIndex, `Expected deployInner to call ${writeCall}`).toBeGreaterThanOrEqual(0);
      expect(ensureIndex, `${writeCall} must happen after ensureFirstApplicationService`).toBeLessThan(
        writeIndex,
      );
    }

    expect(source).not.toContain('projectIdToDeployableServiceId(');
  });

  it('requires service-FK repositories to resolve an existing service before inserts', () => {
    const environmentRepo = readSource('src/db/repos/environment.repo.ts');
    expect(methodBody(environmentRepo, 'async createEnvironment')).toContain(
      'await this.resolveExistingCanonicalServiceId(environment.projectId)',
    );
    expect(methodBody(environmentRepo, 'async createEnvironment')).not.toContain(
      'service_id: projectIdToDeployableServiceId',
    );

    const deployLogRepo = readSource('src/db/repos/deploy-log.repo.ts');
    expect(methodBody(deployLogRepo, 'async createDeployLog')).toContain(
      'await this.resolveExistingCanonicalServiceId(log.projectId)',
    );
    expect(methodBody(deployLogRepo, 'async createDeployLog')).not.toContain(
      'service_id: projectIdToDeployableServiceId',
    );

    const deployConfigRepo = readSource('src/db/repos/deploy-config.repo.ts');
    expect(methodBody(deployConfigRepo, 'async save')).toContain(
      'await this.resolveExistingCanonicalServiceId(projectId)',
    );
    expect(methodBody(deployConfigRepo, 'async save')).not.toContain(
      'projectIdToServiceId(projectId)',
    );

    const incidentRepo = readSource('src/db/repos/runtime-incident.repo.ts');
    expect(methodBody(incidentRepo, 'async createIncident')).toContain(
      'await this.resolveExistingCanonicalServiceId(opts.projectId)',
    );
    expect(methodBody(incidentRepo, 'async createIncident')).not.toContain(
      'service_id: opts.serviceId ?? projectIdToServiceId',
    );

    const connectionRepo = readSource('src/db/repos/service-connection.repo.ts');
    expect(methodBody(connectionRepo, 'async createConnection')).toContain(
      'await this.resolveExistingCanonicalConsumerId(opts.projectId)',
    );
    expect(methodBody(connectionRepo, 'async upsertConnection')).toContain(
      'opts.consumerServiceId ?? (await this.resolveExistingCanonicalConsumerId(opts.projectId))',
    );
    expect(methodBody(connectionRepo, 'async createConnection')).not.toContain(
      'service_id_consumer: projectIdToDeployableServiceId',
    );
    expect(methodBody(connectionRepo, 'async upsertConnection')).not.toContain(
      'service_id_consumer: projectIdToDeployableServiceId',
    );
  });

  it('keeps ManagedServiceLinker on concrete consumer service ids', () => {
    const source = readSource('src/pipeline/managed-service-linker.ts');
    expect(source).toContain('consumerServiceId: consumer.id');
    expect(source).toContain('source_service_id: consumer.id');
    expect(source).not.toContain('projectIdToDeployableServiceId(');
  });
});
