import type { Docker } from '../docker.js';

export interface ConnectivityResult {
  hostname: string;
  port?: number;
  dnsResolved: boolean;
  tcpReachable: boolean;
  error?: string;
}

interface EndpointTarget {
  hostname: string;
  port?: number;
}

const DEFAULT_PORT_BY_PROTOCOL: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'postgres:': 5432,
  'postgresql:': 5432,
  'mysql:': 3306,
  'mariadb:': 3306,
  'redis:': 6379,
  'rediss:': 6379,
  'mongodb:': 27017,
  'amqp:': 5672,
  'amqps:': 5671,
};

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
  return parsed;
}

function parseHostValue(rawValue: string): EndpointTarget | null {
  const value = rawValue.trim();
  if (value.length === 0) return null;

  if (value.includes('://')) {
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.trim();
      const port = parsePort(parsed.port);
      if (hostname.length === 0) return null;
      return { hostname, port };
    } catch {
      return null;
    }
  }

  if (value.startsWith('[') && value.includes(']')) {
    const closingIndex = value.indexOf(']');
    const hostname = value.slice(1, closingIndex).trim();
    const hasPort = value[closingIndex + 1] === ':';
    const port = hasPort ? parsePort(value.slice(closingIndex + 2)) : undefined;
    return hostname.length > 0 ? { hostname, port } : null;
  }

  const colonCount = value.split(':').length - 1;
  if (colonCount === 1) {
    const [hostPart = '', portPart = ''] = value.split(':');
    const hostname = hostPart.trim();
    const port = parsePort(portPart.trim());
    if (hostname && hostname.length > 0) {
      return { hostname, port };
    }
  }

  return { hostname: value };
}

function extractEndpointTargets(envVars: Record<string, string>): EndpointTarget[] {
  const targets = new Map<string, EndpointTarget>();

  for (const [key, value] of Object.entries(envVars)) {
    if (key.endsWith('_URL')) {
      try {
        const parsed = new URL(value);
        const hostname = parsed.hostname.trim();
        if (hostname.length === 0) continue;
        const explicitPort = parsePort(parsed.port);
        const defaultPort = DEFAULT_PORT_BY_PROTOCOL[parsed.protocol];
        const port = explicitPort ?? defaultPort;
        const targetKey = `${hostname}:${port !== undefined ? String(port) : 'none'}`;
        targets.set(targetKey, { hostname, port });
      } catch {
        continue;
      }
      continue;
    }

    if (!key.endsWith('_HOST')) continue;

    const parsed = parseHostValue(value);
    if (!parsed) continue;
    const hostname = parsed.hostname.trim();
    if (hostname.length === 0) continue;

    const inferredPortKey = `${key.slice(0, -5)}_PORT`;
    const inferredPort = parsePort(envVars[inferredPortKey]);
    const port = parsed.port || inferredPort;
    const targetKey = `${hostname}:${port !== undefined ? String(port) : 'none'}`;
    targets.set(targetKey, { hostname, port });
  }

  return Array.from(targets.values());
}

async function runInContainer(
  docker: Docker,
  containerId: string,
  command: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number; startFailed: boolean }> {
  try {
    const result = await docker.execSimple(containerId, command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      startFailed: false,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      startFailed: true,
    };
  }
}

function compactErrorText(stderr: string, stdout: string): string | undefined {
  const text = stderr.trim() || stdout.trim();
  if (text.length === 0) return undefined;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export async function checkDeployConnectivity(params: {
  docker: Docker;
  containerId: string;
  envVars: Record<string, string>;
}): Promise<ConnectivityResult[]> {
  const { docker, containerId, envVars } = params;
  const targets = extractEndpointTargets(envVars);
  if (targets.length === 0) return [];

  const getentProbe = await runInContainer(docker, containerId, ['getent', 'hosts', 'localhost']);
  if (getentProbe.startFailed) return [];

  const ncProbe = await runInContainer(docker, containerId, ['nc', '-z', '-w1', '127.0.0.1', '1']);
  if (ncProbe.startFailed) return [];

  const results: ConnectivityResult[] = [];

  for (const target of targets) {
    const dnsCheck = await runInContainer(docker, containerId, [
      'getent',
      'hosts',
      target.hostname,
    ]);
    const dnsResolved = dnsCheck.exitCode === 0;

    if (!dnsResolved) {
      results.push({
        hostname: target.hostname,
        port: target.port,
        dnsResolved: false,
        tcpReachable: false,
        error: compactErrorText(dnsCheck.stderr, dnsCheck.stdout),
      });
      continue;
    }

    if (target.port === undefined) {
      results.push({
        hostname: target.hostname,
        dnsResolved: true,
        tcpReachable: false,
        error: 'Port not specified',
      });
      continue;
    }

    const tcpCheck = await runInContainer(docker, containerId, [
      'nc',
      '-z',
      '-w2',
      target.hostname,
      String(target.port),
    ]);
    const tcpReachable = tcpCheck.exitCode === 0;
    results.push({
      hostname: target.hostname,
      port: target.port,
      dnsResolved: true,
      tcpReachable,
      error: tcpReachable ? undefined : compactErrorText(tcpCheck.stderr, tcpCheck.stdout),
    });
  }

  return results;
}
