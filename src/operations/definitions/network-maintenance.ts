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
  version: 1,
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
          'Network inventory is read-only. Cleanup requires the exact network name and id, zero endpoints, and human approval.',
        next_steps: cleanupCandidate
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
