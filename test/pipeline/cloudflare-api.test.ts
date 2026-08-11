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

  it('reads a tracked DNS record directly by id', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: 'record-1',
        type: 'CNAME',
        name: 'app.example.com',
        content: 'tunnel-1.cfargotunnel.com',
      }),
    );
    const client = new CloudflareApiClient('token', fetcher);

    await expect(client.getDnsRecord('zone-1', 'record-1')).resolves.toMatchObject({
      id: 'record-1',
      name: 'app.example.com',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/record-1',
    );
  });

  it('returns null when a tracked DNS record was removed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, errors: [{ message: 'not found' }] }), {
        status: 404,
      }),
    );
    const client = new CloudflareApiClient('token', fetcher);

    await expect(client.getDnsRecord('zone-1', 'missing')).resolves.toBeNull();
  });

  it('allows slow Cloudflare reads enough time to complete', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse([]));
    const client = new CloudflareApiClient('token', fetcher);

    await client.listDnsRecords('zone-1', 'app.example.com');

    expect(timeout).toHaveBeenCalledWith(20_000);
    timeout.mockRestore();
  });

  it('cleans up tracked connector connections before tunnel deletion', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({}));
    const client = new CloudflareApiClient('token', fetcher);

    await client.cleanupTunnelConnections('account-1', 'tunnel-1');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account-1/cfd_tunnel/tunnel-1/connections',
      expect.objectContaining({ method: 'DELETE' }),
    );
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

  it('retries retry-safe requests after a transient network failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse([{ id: 'zone-1', name: 'example.com' }]));
    const client = new CloudflareApiClient('token', fetcher);

    const assertion = expect(client.listZones('account-1')).resolves.toEqual([
      { id: 'zone-1', name: 'example.com' },
    ]);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry non-idempotent Cloudflare writes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed'));
    const client = new CloudflareApiClient('token', fetcher);

    await expect(
      client.createTunnelDnsRecord('zone-1', 'app.example.com', 'tunnel-1'),
    ).rejects.toMatchObject({
      code: 'CLOUDFLARE_UNREACHABLE',
      details: expect.objectContaining({ operation: 'create_dns_record', retryable: true }),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports an unreachable error after retry-safe requests exhaust retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const client = new CloudflareApiClient('token', fetcher);

    const assertion = expect(
      client.updateTunnelConfiguration('account-1', 'tunnel-1', [{ service: 'http_status:404' }]),
    ).rejects.toMatchObject({
      code: 'CLOUDFLARE_UNREACHABLE',
      details: expect.objectContaining({ operation: 'update_tunnel_configuration' }),
    });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetcher).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });
});
