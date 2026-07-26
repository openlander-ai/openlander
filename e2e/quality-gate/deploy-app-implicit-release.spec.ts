import { expect, test } from '@playwright/test';

import { deleteProject, mcpCall, uniqueProjectName } from './fixtures/api.js';

const REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';

type McpToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function parseToolCallResult<T>(envelope: McpToolCallEnvelope): T {
  if (envelope.isError === true) {
    const text = envelope.content?.find((item) => item.type === 'text')?.text;
    throw new Error(`MCP tool returned error: ${text ?? JSON.stringify(envelope)}`);
  }
  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text as string) as T;
}

test('deploy_app records the exact deployed digest as an implicit Release', async () => {
  test.setTimeout(240_000);
  let projectId: string | undefined;

  try {
    await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'implicit-release-quality-gate', version: '1.0.0' },
    });
    const envelope = (await mcpCall('tools/call', {
      name: 'openlander_deploy',
      arguments: {
        action: 'deploy_app',
        params: {
          repo_url: REPO_URL,
          branch: 'main',
          name: uniqueProjectName('deploy-app-release'),
          wait: true,
          wait_healthy: false,
          timeout: 180,
        },
      },
    })) as McpToolCallEnvelope;
    const deployed = parseToolCallResult<{
      status: string;
      project_id: string;
      implicit_release?: {
        status: string;
        delivery_id: string;
        run_id: string;
        release_id: string;
        image_digests: Record<string, string>;
      };
      warnings?: string[];
    }>(envelope);
    projectId = deployed.project_id;

    expect(deployed.status).toBe('done');
    expect(deployed.warnings ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('implicit Release adoption failed')]),
    );
    expect(deployed.implicit_release).toMatchObject({ status: 'ready' });
    expect(Object.values(deployed.implicit_release?.image_digests ?? {})).toEqual([
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    ]);

    const releaseEnvelope = (await mcpCall('tools/call', {
      name: 'openlander_deploy',
      arguments: {
        action: 'get_release',
        params: { release_id: deployed.implicit_release?.release_id },
      },
    })) as McpToolCallEnvelope;
    const release = parseToolCallResult<{
      release: { status: string };
      artifacts: Array<{
        image_reference: string;
        image_digest: string;
        build_provenance: { rebuilt?: boolean; source?: string };
      }>;
    }>(releaseEnvelope);

    expect(release.release.status).toBe('ready');
    expect(release.artifacts).toHaveLength(1);
    expect(release.artifacts[0]?.image_reference).toBe(release.artifacts[0]?.image_digest);
    expect(release.artifacts[0]?.build_provenance).toMatchObject({
      source: 'deploy_app_compatibility',
      rebuilt: false,
    });
  } finally {
    if (projectId) {
      await deleteProject(projectId);
    }
  }
});
