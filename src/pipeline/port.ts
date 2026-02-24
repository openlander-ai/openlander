import type { Database } from '../db/index.js';
import { PortExhaustedError } from '../errors.js';

/** Default port range for OpenLander-managed containers. */
const PORT_RANGE_START = 10001;
const PORT_RANGE_END = 10999;

/**
 * Allocate a unique port for a new container.
 *
 * Scans the database for currently assigned ports and returns
 * the next available one in the range.
 */
export function allocatePort(
  db: Database,
  rangeStart = PORT_RANGE_START,
  rangeEnd = PORT_RANGE_END,
): number {
  const usedPorts = db.getUsedPorts();
  const usedSet = new Set(usedPorts);

  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (!usedSet.has(port)) {
      return port;
    }
  }

  throw new PortExhaustedError(rangeStart, rangeEnd, usedPorts.length);
}

/** Check if a specific port is available. */
export function isPortAvailable(db: Database, port: number): boolean {
  const usedPorts = db.getUsedPorts();
  return !usedPorts.includes(port);
}

/** Get the count of available ports. */
export function getAvailablePortCount(
  db: Database,
  rangeStart = PORT_RANGE_START,
  rangeEnd = PORT_RANGE_END,
): number {
  const total = rangeEnd - rangeStart + 1;
  const used = db.getUsedPorts().length;
  return total - used;
}
