import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockNetworkInterfaces } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, networkInterfaces: mockNetworkInterfaces };
});

import { getLanIp, getAllIps } from '../src/pipeline/traefik.js';

function ipv4(address: string, iface?: { internal?: boolean }) {
  return {
    address,
    family: 'IPv4' as const,
    internal: iface?.internal ?? false,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: `${address}/24`,
  };
}

describe('getLanIp', () => {
  beforeEach(() => {
    mockNetworkInterfaces.mockReset();
  });

  it('returns LAN IP when only LAN interfaces exist', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth0: [ipv4('192.168.1.100')],
    });

    expect(getLanIp()).toBe('192.168.1.100');
  });

  it('prefers LAN IP over VPN (Tailscale) IP', () => {
    mockNetworkInterfaces.mockReturnValue({
      tailscale0: [ipv4('100.75.249.124')],
      eth0: [ipv4('192.168.50.118')],
    });

    expect(getLanIp()).toBe('192.168.50.118');
  });

  it('prefers LAN IP over Docker bridge IP', () => {
    mockNetworkInterfaces.mockReturnValue({
      'br-abc123': [ipv4('172.18.0.1')],
      docker0: [ipv4('172.17.0.1')],
      wlan0: [ipv4('192.168.219.133')],
    });

    expect(getLanIp()).toBe('192.168.219.133');
  });

  it('falls back to VPN IP when no LAN interface exists', () => {
    mockNetworkInterfaces.mockReturnValue({
      tailscale0: [ipv4('100.92.129.118')],
    });

    expect(getLanIp()).toBe('100.92.129.118');
  });

  it('skips Docker bridge interfaces entirely', () => {
    mockNetworkInterfaces.mockReturnValue({
      docker0: [ipv4('172.17.0.1')],
      veth1234: [ipv4('172.18.0.2')],
    });

    expect(getLanIp()).toBeUndefined();
  });

  it('returns undefined when no non-internal IPv4 exists', () => {
    mockNetworkInterfaces.mockReturnValue({
      lo: [ipv4('127.0.0.1', { internal: true })],
    });

    expect(getLanIp()).toBeUndefined();
  });

  it('skips IPv6 addresses', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth0: [
        {
          address: 'fe80::1',
          family: 'IPv6',
          internal: false,
          netmask: 'ffff:ffff:ffff:ffff::',
          mac: '00:00:00:00:00:00',
          cidr: 'fe80::1/64',
          scopeid: 0,
        },
        ipv4('10.0.0.5'),
      ],
    });

    expect(getLanIp()).toBe('10.0.0.5');
  });

  it('handles WireGuard VPN interface (wg0)', () => {
    mockNetworkInterfaces.mockReturnValue({
      wg0: [ipv4('10.13.13.1')],
      enp3s0: [ipv4('192.168.50.118')],
    });

    expect(getLanIp()).toBe('192.168.50.118');
  });

  it('handles ZeroTier interface (zt0)', () => {
    mockNetworkInterfaces.mockReturnValue({
      zt0: [ipv4('172.28.0.5')],
      eth0: [ipv4('10.0.0.50')],
    });

    expect(getLanIp()).toBe('10.0.0.50');
  });

  it('handles 100.x.x.x address even on non-VPN-named interface', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth1: [ipv4('100.64.0.1')],
      eth0: [ipv4('192.168.1.5')],
    });

    expect(getLanIp()).toBe('192.168.1.5');
  });
});

describe('getAllIps', () => {
  beforeEach(() => {
    mockNetworkInterfaces.mockReset();
  });

  it('sorts LAN IPs before VPN IPs', () => {
    mockNetworkInterfaces.mockReturnValue({
      tailscale0: [ipv4('100.75.249.124')],
      eth0: [ipv4('192.168.50.118')],
    });

    const ips = getAllIps();
    expect(ips[0]).toMatchObject({ address: '192.168.50.118', type: 'lan' });
    expect(ips[1]).toMatchObject({ address: '100.75.249.124', type: 'vpn' });
  });

  it('excludes Docker bridge interfaces', () => {
    mockNetworkInterfaces.mockReturnValue({
      docker0: [ipv4('172.17.0.1')],
      'br-abc123': [ipv4('172.18.0.1')],
      eth0: [ipv4('192.168.1.100')],
    });

    const ips = getAllIps();
    expect(ips).toHaveLength(1);
    expect(ips[0]).toMatchObject({ address: '192.168.1.100', type: 'lan' });
  });

  it('classifies 100.x addresses as VPN', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth1: [ipv4('100.64.0.1')],
    });

    const ips = getAllIps();
    expect(ips[0]).toMatchObject({ type: 'vpn' });
  });
});
