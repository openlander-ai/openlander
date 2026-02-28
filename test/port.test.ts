import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  allocatePort,
  isPortAvailable,
  getAvailablePortCount,
  scanUsedPorts,
  clearPortScanCache,
} from '../src/pipeline/port.js';
import { Database } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';

// Mock Docker instance for tests
function createMockDocker(
  containers: { state: string; ports: { PublicPort?: number }[] }[] = [],
): Docker {
  return {
    listAllContainers: vi.fn().mockResolvedValue(
      containers.map((c, i) => ({
        id: `container-${i}`,
        name: `test-container-${i}`,
        image: 'test-image',
        state: c.state,
        status: 'Up',
        ports: c.ports.map((p) => ({ PublicPort: p.PublicPort })),
        labels: {},
        managedByOpenLander: false,
        composeProject: null,
        created: Date.now(),
      })),
    ),
  } as unknown as Docker;
}

describe('Port Allocation', () => {
  let db: Database;
  let tmpDir: string;
  let docker: Docker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    clearPortScanCache();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allocates first port in range', async () => {
    const port = await allocatePort(db, docker, 10001, 10010);
    expect(port).toBe(10001);
  });

  it('skips used ports', async () => {
    // Create project with port 10001
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/test' });
    db.updateProject('p1', { assignedPort: 10001 });

    const port = await allocatePort(db, docker, 10001, 10010);
    expect(port).toBe(10002);
  });

  it('skips multiple used ports', async () => {
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    db.createProject({ id: 'p2', name: 'project-2', repoUrl: 'https://github.com/test/b' });
    db.updateProject('p2', { assignedPort: 10002 });

    db.createProject({ id: 'p3', name: 'project-3', repoUrl: 'https://github.com/test/c' });
    db.updateProject('p3', { assignedPort: 10003 });

    const port = await allocatePort(db, docker, 10001, 10010);
    expect(port).toBe(10004);
  });

  it('throws when all ports exhausted', async () => {
    // Fill the range (3 ports)
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    db.createProject({ id: 'p2', name: 'project-2', repoUrl: 'https://github.com/test/b' });
    db.updateProject('p2', { assignedPort: 10002 });

    db.createProject({ id: 'p3', name: 'project-3', repoUrl: 'https://github.com/test/c' });
    db.updateProject('p3', { assignedPort: 10003 });

    await expect(allocatePort(db, docker, 10001, 10003)).rejects.toThrow('No available ports');
  });

  it('isPortAvailable returns true for unused port', () => {
    expect(isPortAvailable(db, 10001)).toBe(true);
  });

  it('isPortAvailable returns false for used port', () => {
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    expect(isPortAvailable(db, 10001)).toBe(false);
  });

  it('getAvailablePortCount returns correct count', () => {
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    const count = getAvailablePortCount(db, 10001, 10010);
    expect(count).toBe(9); // 10 total - 1 used
  });
});

describe('scanUsedPorts', () => {
  let db: Database;
  let tmpDir: string;
  let docker: Docker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    clearPortScanCache();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('combines DB + Docker + OS ports', async () => {
    // DB port
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/test' });
    db.updateProject('p1', { assignedPort: 10001 });

    // Docker container with port
    docker = createMockDocker([{ state: 'running', ports: [{ PublicPort: 8080 }] }]);

    const result = await scanUsedPorts(db, docker);

    expect(result.db).toContain(10001);
    expect(result.docker).toContain(8080);
    expect(result.all).toContain(10001);
    expect(result.all).toContain(8080);
  });

  it('detects conflicts with default OpenLander ports', async () => {
    docker = createMockDocker([
      { state: 'running', ports: [{ PublicPort: 80 }] },
      { state: 'running', ports: [{ PublicPort: 443 }] },
    ]);

    const result = await scanUsedPorts(db, docker);

    expect(result.conflicts).toContain(80);
    expect(result.conflicts).toContain(443);
  });

  it('handles Docker daemon not running', async () => {
    const failingDocker = {
      listAllContainers: vi.fn().mockRejectedValue(new Error('Docker not running')),
    } as unknown as Docker;

    const result = await scanUsedPorts(db, failingDocker);

    expect(result.docker).toEqual([]);
    expect(result.all).toBeDefined();
  });

  it('includes restarting container ports', async () => {
    docker = createMockDocker([{ state: 'restarting', ports: [{ PublicPort: 3000 }] }]);

    const result = await scanUsedPorts(db, docker);

    expect(result.docker).toContain(3000);
  });

  it('caches results for 1 second', async () => {
    docker = createMockDocker([{ state: 'running', ports: [{ PublicPort: 8080 }] }]);

    await scanUsedPorts(db, docker);
    await scanUsedPorts(db, docker);

    expect(docker.listAllContainers).toHaveBeenCalledTimes(1);
  });

  it('clears cache after TTL', async () => {
    docker = createMockDocker([{ state: 'running', ports: [{ PublicPort: 8080 }] }]);

    await scanUsedPorts(db, docker);

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await scanUsedPorts(db, docker);

    expect(docker.listAllContainers).toHaveBeenCalledTimes(2);
  });
});
