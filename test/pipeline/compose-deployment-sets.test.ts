import { describe, expect, it } from 'vitest';

import {
  planComposeDeploymentSets,
  type ComposeDeploymentSets,
} from '../../src/pipeline/compose-deployment-sets.js';
import { inferComposeRuntimeRoles, type ComposeService } from '../../src/pipeline/compose.js';

const services: ComposeService[] = [
  { name: 'db', image: 'pgvector/pgvector:pg16' },
  { name: 'migrate', image: 'incar-api', dependsOn: ['db'] },
  {
    name: 'api',
    image: 'incar-api',
    dependsOn: ['migrate', 'db'],
    dependsOnConditions: { migrate: 'service_completed_successfully' },
  },
  { name: 'logto', image: 'logto', dependsOn: ['api'] },
  { name: 'web', image: 'incar-web', dependsOn: ['api', 'logto'] },
];

function names(set: Set<string>): string[] {
  return [...set].sort();
}

function expectSets(
  actual: ComposeDeploymentSets,
  expected: { replace: string[]; prerequisites: string[]; hooks: string[] },
): void {
  expect(names(actual.replaceTargets)).toEqual(expected.replace);
  expect(names(actual.prerequisites)).toEqual(expected.prerequisites);
  expect(names(actual.runOnceHooks)).toEqual(expected.hooks);
  expect(names(actual.includedServices)).toEqual(
    [...new Set([...expected.replace, ...expected.prerequisites, ...expected.hooks])].sort(),
  );
}

describe('planComposeDeploymentSets', () => {
  const runtimeRoles = inferComposeRuntimeRoles(services);

  it('replaces only web and verifies transitive prerequisites without running migration', () => {
    const plan = planComposeDeploymentSets({
      services,
      runtimeRoles,
      selectedServices: ['web'],
      existingServices: new Set(services.map((service) => service.name)),
    });

    expectSets(plan, {
      replace: ['web'],
      prerequisites: ['api', 'db', 'logto'],
      hooks: [],
    });
  });

  it('runs migration before a directly selected api replacement', () => {
    const plan = planComposeDeploymentSets({
      services,
      runtimeRoles,
      selectedServices: ['api'],
      existingServices: new Set(services.map((service) => service.name)),
    });

    expectSets(plan, {
      replace: ['api'],
      prerequisites: ['db'],
      hooks: ['migrate'],
    });
  });

  it('replaces only changed applications during a full redeploy', () => {
    const previous = Object.fromEntries(services.map((service) => [service.name, 'same']));
    const current = { ...previous, api: 'changed' };
    const plan = planComposeDeploymentSets({
      services,
      runtimeRoles,
      existingServices: new Set(services.map((service) => service.name)),
      previousFingerprints: previous,
      currentFingerprints: current,
    });

    expectSets(plan, {
      replace: ['api'],
      prerequisites: ['db', 'logto', 'web'],
      hooks: ['migrate'],
    });
  });

  it('replaces every application for a new source revision while preserving resources', () => {
    const fingerprints = Object.fromEntries(services.map((service) => [service.name, 'same']));
    const plan = planComposeDeploymentSets({
      services,
      runtimeRoles,
      existingServices: new Set(services.map((service) => service.name)),
      previousFingerprints: fingerprints,
      currentFingerprints: fingerprints,
      forceReplaceApplications: true,
    });

    expectSets(plan, {
      replace: ['api', 'logto', 'web'],
      prerequisites: ['db'],
      hooks: ['migrate'],
    });
  });

  it('creates all applications, resources, and required jobs on first deploy', () => {
    const plan = planComposeDeploymentSets({
      services,
      runtimeRoles,
      currentFingerprints: Object.fromEntries(
        services.map((service) => [service.name, service.name]),
      ),
    });

    expectSets(plan, {
      replace: ['api', 'logto', 'web'],
      prerequisites: ['db'],
      hooks: ['migrate'],
    });
  });
});
