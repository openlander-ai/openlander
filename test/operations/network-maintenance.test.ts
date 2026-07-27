import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import {
  listDockerNetworksOperation,
  removeUnusedDockerNetworkOperation,
} from '../../src/operations/definitions/network-maintenance.js';
import { createApplicationOperationRegistry } from '../../src/operations/registry.js';
import { networkOperationToolDefs } from '../../src/tools/defs/network-operations.js';

const currentNetwork = {
  id: 'current-id',
  name: 'ol-current',
  driver: 'bridge',
  scope: 'local',
  subnets: ['172.30.0.0/16'],
  labels: { 'openlander.instance': 'olinst_a' },
  endpointCount: 0,
  ownerInstanceId: 'olinst_a',
  ownership: 'current_instance' as const,
  cleanupEligible: true,
  cleanupBlocker: null,
};

const legacyNetwork = {
  ...currentNetwork,
  id: 'legacy-id',
  name: 'ol-legacy',
  labels: {},
  ownerInstanceId: null,
  ownership: 'legacy_unlabeled' as const,
  cleanupEligible: false,
  cleanupBlocker: 'legacy_confirmation_required',
};

function actor(source: 'web' | 'rest' | 'mcp' = 'mcp') {
  return {
    source,
    scope: 'org' as const,
    instanceId: 'olinst_a',
    label: `${source}-actor`,
  };
}

describe('Docker network maintenance operations', () => {
  it('registers both operations with instance-wide scopes', () => {
    const definitions = createApplicationOperationRegistry().list();
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'list_docker_networks',
          kind: 'query',
          allowedScopes: ['instance', 'org'],
        }),
        expect.objectContaining({
          name: 'remove_unused_docker_network',
          kind: 'command',
          idempotency: 'required',
          allowedScopes: ['instance', 'org'],
        }),
      ]),
    );
  });

  it('returns compact ownership and cleanup guidance without external rows by default', async () => {
    const listNetworks = vi.fn().mockResolvedValue([
      currentNetwork,
      legacyNetwork,
      {
        ...currentNetwork,
        id: 'external-id',
        name: 'compose_default',
        ownerInstanceId: null,
        ownership: 'external',
        cleanupEligible: false,
        cleanupBlocker: 'unmanaged_network',
      },
    ]);
    const ctx = { docker: { listNetworks } } as unknown as AppContext;
    const result = await listDockerNetworksOperation.execute(
      { include_external: false },
      { appCtx: ctx, actor: actor(), operationId: null },
    );

    expect(result).toMatchObject({
      status: 'ok',
      network_count: 3,
      returned_count: 2,
      cleanup_eligible_count: 1,
      legacy_confirmation_count: 1,
      external_count: 1,
      networks: [
        expect.objectContaining({
          network_id: 'current-id',
          ownership: 'current_instance',
          cleanup_eligible: true,
        }),
        expect.objectContaining({
          network_id: 'legacy-id',
          cleanup_blocker: 'legacy_confirmation_required',
        }),
      ],
      suggested_call: {
        operation: 'remove_unused_docker_network',
        input: { network_name: 'ol-current', network_id: 'current-id' },
      },
    });
    expect(listDockerNetworksOperation.outputSchema.safeParse(result).success).toBe(true);
  });

  it('allows an exact web-session cleanup but rejects raw REST API-token mutation', async () => {
    const removeUnusedNetwork = vi.fn().mockResolvedValue(currentNetwork);
    const ctx = { docker: { removeUnusedNetwork } } as unknown as AppContext;

    await expect(
      removeUnusedDockerNetworkOperation.execute(
        {
          network_name: currentNetwork.name,
          network_id: currentNetwork.id,
          allow_legacy_unlabeled: false,
        },
        { appCtx: ctx, actor: actor('web'), operationId: 'operation-1' },
      ),
    ).resolves.toMatchObject({
      status: 'removed',
      network_name: currentNetwork.name,
      network_id: currentNetwork.id,
    });
    await expect(
      removeUnusedDockerNetworkOperation.execute(
        {
          network_name: currentNetwork.name,
          network_id: currentNetwork.id,
          allow_legacy_unlabeled: false,
        },
        { appCtx: ctx, actor: actor('rest'), operationId: 'operation-2' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_REQUIRES_HUMAN_UI' });
    expect(removeUnusedNetwork).toHaveBeenCalledOnce();
  });

  it('marks the remove adapter high risk and the inventory adapter low risk', () => {
    expect(
      networkOperationToolDefs.find((definition) => definition.name === 'list_docker_networks'),
    ).toMatchObject({ riskLevel: 'low', targets: ['mcp'] });
    expect(
      networkOperationToolDefs.find(
        (definition) => definition.name === 'remove_unused_docker_network',
      ),
    ).toMatchObject({ riskLevel: 'high', targets: ['mcp'] });
  });

  it('rejects project-scoped inventory before reading host Docker state', async () => {
    const listNetworks = vi.fn();
    const ctx = { docker: { listNetworks } } as unknown as AppContext;
    await expect(
      createApplicationOperationRegistry().execute(
        ctx,
        'list_docker_networks',
        {},
        {
          actor: {
            source: 'mcp',
            scope: 'project',
            instanceId: 'olinst_a',
            projectId: 'project-1',
            label: 'project-agent',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(listNetworks).not.toHaveBeenCalled();
  });
});
