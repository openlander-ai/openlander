import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { Database } from '../db/index.js';
import { PortExhaustedError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { getEnvDefaults } from '../config/index.js';
import type { Docker } from './docker.js';

const log = createModuleLogger('port');
const execAsync = promisify(exec);

/** OpenLander default ports that may conflict with external services. */
const OPENLANDER_DEFAULT_PORTS = [80, 443, 8080];

/** Result of scanning all port sources. */
export interface PortScanResult {
  /** Ports from OpenLander database (managed projects). */
  db: number[];
  /** Ports from all Docker containers (including external). */
  docker: number[];
  /** Ports from OS-level processes (ss/lsof scan). */
  os: number[];
  /** All unique ports in use across all sources. */
  all: number[];
  /** Ports that conflict with OpenLander default ports (80, 443, 8080). */
  conflicts: number[];
}

/** Cache for scanUsedPorts with 1-second TTL. */
let portScanCache: { result: PortScanResult; timestamp: number } | null = null;
const PORT_SCAN_CACHE_TTL_MS = 1000;

/** In-memory port reservations for concurrent deploy coordination. */
const reservedPorts = new Set<number>();

/**
 * Scan OS-level ports using platform-specific commands.
 * Linux: ss -tln (sudo not required)
 * macOS: lsof -iTCP -sTCP:LISTEN (sudo not required)
 * Returns empty array on error (logs warning, does not throw).
 */
async function scanOSPorts(): Promise<number[]> {
  const platform = process.platform;
  try {
    if (platform === 'linux') {
      const { stdout } = await execAsync('ss -tln');
      return parseSSOutput(stdout);
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN');
      return parseLsofOutput(stdout);
    } else {
      log.warn({ platform }, 'Unsupported platform for OS port scan');
      return [];
    }
  } catch (error) {
    log.warn({ error, platform }, 'Failed to scan OS ports, returning empty array');
    return [];
  }
}

/** Parse ss -tln output and extract port numbers. */
function parseSSOutput(output: string): number[] {
  const ports: number[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    // Format: LISTEN  0  128  *:80  *:*
    // or: LISTEN  0  128  [::]:8080  *:*
    const match = line.match(/[:[]([0-9]+)]?\s*$/);
    if (match && match[1]) {
      const port = parseInt(match[1], 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        ports.push(port);
      }
    }
  }
  return ports;
}

/** Parse lsof -iTCP -sTCP:LISTEN output and extract port numbers. */
function parseLsofOutput(output: string): number[] {
  const ports: number[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    // Format: COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME
    // nginx   1234  root  6u  IPv4  12345  0t0  TCP  *:80 (LISTEN)
    const match = line.match(/[:*]([0-9]+)\s*\(LISTEN\)?/);
    if (match && match[1]) {
      const port = parseInt(match[1], 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        ports.push(port);
      }
    }
  }
  return ports;
}

/**
 * Scan all port sources: DB, Docker, and OS.
 * Results are cached for 1 second to avoid redundant scans.
 */
export async function scanUsedPorts(db: Database, docker: Docker): Promise<PortScanResult> {
  // Check cache
  const now = Date.now();
  if (portScanCache && now - portScanCache.timestamp < PORT_SCAN_CACHE_TTL_MS) {
    return portScanCache.result;
  }

  // 1. DB ports (OpenLander managed projects)
  const dbPorts = db.getUsedPorts();

  // 2. Docker ports (all containers)
  let dockerPorts: number[] = [];
  try {
    const containers = await docker.listAllContainers();
    // Include ports from running AND restarting containers
    dockerPorts = containers
      .filter((c) => c.state === 'running' || c.state === 'restarting')
      .flatMap((c) =>
        c.ports
          .filter((p): p is typeof p & { PublicPort: number } => p.PublicPort !== undefined)
          .map((p) => p.PublicPort),
      );
  } catch (error) {
    log.warn({ error }, 'Failed to list Docker containers for port scan');
    // Continue with empty Docker ports
  }

  // 3. OS ports
  const osPorts = await scanOSPorts();

  // Combine all ports
  const allPorts = [...new Set([...dbPorts, ...dockerPorts, ...osPorts])];

  // Find conflicts with OpenLander default ports
  const conflicts = allPorts.filter((p) => OPENLANDER_DEFAULT_PORTS.includes(p));

  const result: PortScanResult = {
    db: dbPorts,
    docker: dockerPorts,
    os: osPorts,
    all: allPorts,
    conflicts,
  };

  // Update cache
  portScanCache = { result, timestamp: now };

  return result;
}

/** Clear the port scan cache (useful for testing). */
export function clearPortScanCache(): void {
  portScanCache = null;
}

/** Clear port reservations (useful for testing). */
export function clearPortReservations(): void {
  reservedPorts.clear();
}

export interface AllocatePortOptions {
  preferredPort?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export async function allocatePort(
  db: Database,
  docker: Docker,
  options: AllocatePortOptions = {},
): Promise<number> {
  const envDef = getEnvDefaults();
  const {
    preferredPort,
    rangeStart = envDef.portRangeStart,
    rangeEnd = envDef.portRangeEnd,
  } = options;
  const usedPorts = await scanUsedPorts(db, docker);
  const usedSet = new Set(usedPorts.all);

  // Also exclude ports reserved by concurrent deployments
  for (const reserved of reservedPorts) {
    usedSet.add(reserved);
  }

  if (preferredPort && !usedSet.has(preferredPort)) {
    reservedPorts.add(preferredPort); // Reserve immediately
    return preferredPort;
  }

  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (!usedSet.has(port)) {
      reservedPorts.add(port); // Reserve immediately
      return port;
    }
  }

  throw new PortExhaustedError(rangeStart, rangeEnd, usedPorts.all.length);
}

/** Release a port reservation after container creation or on failure. */
export function releasePortReservation(port: number): void {
  reservedPorts.delete(port);
}

/** Check if a specific port is available. */
export function isPortAvailable(db: Database, port: number): boolean {
  const usedPorts = db.getUsedPorts();
  return !usedPorts.includes(port);
}

/** Get the count of available ports. */
export function getAvailablePortCount(
  db: Database,
  rangeStart?: number,
  rangeEnd?: number,
): number {
  const envDef = getEnvDefaults();
  const start = rangeStart ?? envDef.portRangeStart;
  const end = rangeEnd ?? envDef.portRangeEnd;
  const total = end - start + 1;
  const used = db.getUsedPorts().length;
  return total - used;
}
