import { describe, expect, it, vi } from 'vitest';

import { CloudflareApiClient } from '../../src/pipeline/cloudflare-api.js';

function jsonResponse(result: unknown, resultInfo?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], result, result_info: resultInfo }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('CloudflareApiClient', () => {
  it('paginates account results and authenticates with bearer token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 'a1', name: 'One' }], { total_pages: 2 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'a2', name: 'Two' }], { total_pages: 2 }));
    const client = new CloudflareApiClient('secret-token', fetcher);

    await expect(client.listAccounts()).resolves.toEqual([
      { id: 'a1', name: 'One' },
      { id: 'a2', name: 'Two' },
    ]);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('accounts?per_page=50&page=1'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );
  });

  it('creates only a proxied CNAME pointing at the Named Tunnel', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: 'record-1',
        type: 'CNAME',
        name: 'app.example.com',
        content: 'tunnel-1.cfargotunnel.com',
      }),
    );
    const client = new CloudflareApiClient('token', fetcher);

    await client.createTunnelDnsRecord('zone-1', 'app.example.com', 'tunnel-1');
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'CNAME',
      name: 'app.example.com',
      content: 'tunnel-1.cfargotunnel.com',
      proxied: true,
      ttl: 1,
    });
  });

  it('returns a typed error without exposing the access token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, errors: [{ message: 'permission denied' }] }),
          { status: 403 },
        ),
      );
    const client = new CloudflareApiClient('never-leak-this', fetcher);

    const error = await client.listZones('account-1').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'CLOUDFLARE_API_FAILED', statusCode: 502 });
    expect(String(error)).not.toContain('never-leak-this');
  });
});
