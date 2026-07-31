import { z } from 'zod';

import { OperationRequiresHumanUiError } from '../../errors.js';
import type { DockerNetworkSummary } from '../../pipeline/docker/network.js';
import type { ApplicationOperationDefinition } from '../types.js';

const networkOwnershipSchema = z.enum([
  'current_instance',
  'other_instance',
  'legacy_unlabeled',
  'external',
  'system',
]);

const compactNetworkSchema = z.object({
  network_id: z.string(),
  network_name: z.string(),
  driver: z.string(),
  scope: z.string(),
  subnets: z.array(z.string()),
  endpoint_count: z.number().int().nonnegative(),
  owner_instance_id: z.string().nullable(),
  ownership: networkOwnershipSchema,
  cleanup_eligible: z.boolean(),
  cleanup_blocker: z.string().nullable(),
});

const projectNetworkPoolSchema = z
  .object({
    cidr: z.string(),
    subnet_prefix: z.number().int().min(0).max(32),
    total_subnets: z.number().int().nonnegative(),
    unavailable_subnets: z.number().int().nonnegative(),
    available_subnets: z.number().int().nonnegative(),
    pressure: z.enum(['ok', 'low', 'exhausted']),
  })
  .strict();

function compactNetwork(network: DockerNetworkSummary) {
  return {
    network_id: network.id,
    network_name: network.name,
    driver: network.driver,
    scope: network.scope,
    subnets: network.subnets,
    endpoint_count: network.endpointCount,
    owner_instance_id: network.ownerInstanceId,
    ownership: network.ownership,
    cleanup_eligible: network.cleanupEligible,
    cleanup_blocker: network.cleanupBlocker,
  };
}

export const listDockerNetworksOperation: ApplicationOperationDefinition = {
  name: 'list_docker_networks',
  version: 2,
  description:
    'List Docker networks with OpenLander instance ownership, endpoint counts, subnets, and safe cleanup eligibility.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org'],
  inputSchema: z.object({ include_external: z.boolean().optional().default(false) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      network_count: z.number().int().nonnegative(),
      returned_count: z.number().int().nonnegative(),
      cleanup_eligible_count: z.number().int().nonnegative(),
      legacy_confirmation_count: z.number().int().nonnegative(),
      external_count: z.number().int().nonnegative(),
      project_network_pool: projectNetworkPoolSchema,
      networks: z.array(compactNetworkSchema),
      suggested_call: z
        .object({
          operation: z.literal('remove_unused_docker_network'),
          input: z.object({
            network_name: z.string(),
            network_id: z.string(),
            allow_legacy_unlabeled: z.boolean().optional(),
          }),
        })
        .optional(),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const networks = await context.appCtx.docker.listNetworks();
    const projectNetworkPool = context.appCtx.docker.getProjectNetworkPoolStatus(networks);
    const includeExternal = input['include_external'] === true;
    const visible = includeExternal
      ? networks
      : networks.filter(
          (network) => network.ownership !== 'external' && network.ownership !== 'system',
        );
    const cleanupCandidate = networks.find(
      (network) =>
        network.cleanupEligible || network.cleanupBlocker === 'legacy_confirmation_required',
    );
    return {
      status: 'ok',
      network_count: networks.length,
      returned_count: visible.length,
      cleanup_eligible_count: networks.filter((network) => network.cleanupEligible).length,
      legacy_confirmation_count: networks.filter(
        (network) => network.cleanupBlocker === 'legacy_confirmation_required',
      ).length,
      external_count: networks.filter((network) => network.ownership === 'external').length,
      project_network_pool: {
        cidr: projectNetworkPool.cidr,
        subnet_prefix: projectNetworkPool.subnetPrefix,
        total_subnets: projectNetworkPool.totalSubnets,
        unavailable_subnets: projectNetworkPool.unavailableSubnets,
        available_subnets: projectNetworkPool.availableSubnets,
        pressure: projectNetworkPool.pressure,
      },
      networks: visible.map(compactNetwork),
      ...(cleanupCandidate
        ? {
            suggested_call: {
              operation: 'remove_unused_docker_network' as const,
              input: {
                network_name: cleanupCandidate.name,
                network_id: cleanupCandidate.id,
                ...(cleanupCandidate.ownership === 'legacy_unlabeled'
                  ? { allow_legacy_unlabeled: true }
                  : {}),
              },
            },
          }
        : {}),
      _agent_guidance: {
        message:
          projectNetworkPool.pressure === 'exhausted'
            ? 'The OpenLander Project network pool is exhausted. Existing networks were not changed.'
            : projectNetworkPool.pressure === 'low'
              ? 'The OpenLander Project network pool is low. Review unused networks before new deployments fail.'
              : 'Network inventory is read-only. Cleanup requires the exact network name and id, zero endpoints, and human approval.',
        next_steps:
          projectNetworkPool.pressure !== 'ok'
            ? [
                'Review zero-endpoint cleanup candidates and confirm their ownership.',
                'Reconfigure docker.projectNetworkPoolCidr if the current pool cannot be reclaimed.',
              ]
            : cleanupCandidate
              ? [
                  'Review the selected network ownership and subnet before requesting cleanup.',
                  'Call the suggested operation once, then poll the returned approval status.',
                ]
              : ['Do not remove active, external, shared, or other-instance networks.'],
      },
    };
  },
};

export const removeUnusedDockerNetworkOperation: ApplicationOperationDefinition = {
  name: 'remove_unused_docker_network',
  version: 1,
  description:
    'Remove one exact zero-endpoint Docker network after ownership checks and human approval.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z
    .object({
      network_name: z.string().trim().min(1).max(255),
      network_id: z.string().trim().min(1).max(128),
      allow_legacy_unlabeled: z.boolean().optional().default(false),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('removed'),
      network_name: z.string(),
      network_id: z.string(),
      ownership: networkOwnershipSchema,
      endpoint_count: z.literal(0),
      suggested_call: z.object({
        operation: z.literal('list_docker_networks'),
        input: z.object({ include_external: z.boolean() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    if (context.actor.source === 'rest') {
      throw new OperationRequiresHumanUiError(
        'remove_unused_docker_network',
        'Docker network cleanup requires a web session or the MCP human approval flow.',
      );
    }
    const removed = await context.appCtx.docker.removeUnusedNetwork({
      networkName: String(input['network_name']),
      expectedNetworkId: String(input['network_id']),
      allowLegacyUnlabeled: input['allow_legacy_unlabeled'] === true,
    });
    return {
      status: 'removed',
      network_name: removed.name,
      network_id: removed.id,
      ownership: removed.ownership,
      endpoint_count: 0,
      suggested_call: {
        operation: 'list_docker_networks',
        input: { include_external: false },
      },
      _agent_guidance: {
        message:
          'The unused Docker network was removed after identity, ownership, and endpoint checks.',
        next_steps: [
          'Re-list Docker networks to confirm the address pool candidate is gone.',
          'Retry the deployment that failed with NETWORK_ADDRESS_POOL_EXHAUSTED.',
        ],
      },
    };
  },
};

export const networkMaintenanceOperations = [
  listDockerNetworksOperation,
  removeUnusedDockerNetworkOperation,
] as const;
