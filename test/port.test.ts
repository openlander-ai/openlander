import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { allocatePort, isPortAvailable, getAvailablePortCount } from '../src/pipeline/port.js';
import { Database } from '../src/db/index.js';

describe('Port Allocation', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allocates first port in range', () => {
    const port = allocatePort(db, 10001, 10010);
    expect(port).toBe(10001);
  });

  it('skips used ports', () => {
    // Create project with port 10001
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/test' });
    db.updateProject('p1', { assignedPort: 10001 });

    const port = allocatePort(db, 10001, 10010);
    expect(port).toBe(10002);
  });

  it('skips multiple used ports', () => {
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    db.createProject({ id: 'p2', name: 'project-2', repoUrl: 'https://github.com/test/b' });
    db.updateProject('p2', { assignedPort: 10002 });

    db.createProject({ id: 'p3', name: 'project-3', repoUrl: 'https://github.com/test/c' });
    db.updateProject('p3', { assignedPort: 10003 });

    const port = allocatePort(db, 10001, 10010);
    expect(port).toBe(10004);
  });

  it('throws when all ports exhausted', () => {
    // Fill the range (3 ports)
    db.createProject({ id: 'p1', name: 'project-1', repoUrl: 'https://github.com/test/a' });
    db.updateProject('p1', { assignedPort: 10001 });

    db.createProject({ id: 'p2', name: 'project-2', repoUrl: 'https://github.com/test/b' });
    db.updateProject('p2', { assignedPort: 10002 });

    db.createProject({ id: 'p3', name: 'project-3', repoUrl: 'https://github.com/test/c' });
    db.updateProject('p3', { assignedPort: 10003 });

    expect(() => allocatePort(db, 10001, 10003)).toThrow('No available ports');
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
