import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readdirSync, statSync } from 'node:fs';
import { findDockerfiles, scanRepoShape } from '../../src/lib/repo-scanner.js';

type DirNode = {
  type: 'dir';
  entries: string[];
};

type FileNode = {
  type: 'file';
};

type Node = DirNode | FileNode;

type MockStat = {
  isFile: () => boolean;
  isDirectory: () => boolean;
};

const mockReaddirSync = readdirSync as unknown as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as unknown as ReturnType<typeof vi.fn>;

function createFsMap(entries: Array<[string, Node]>): Map<string, Node> {
  return new Map(entries);
}

function wireFsMap(fsMap: Map<string, Node>): void {
  mockReaddirSync.mockImplementation((dirPath: string) => {
    const node = fsMap.get(dirPath);
    if (!node || node.type !== 'dir') {
      throw new Error(`ENOENT: ${dirPath}`);
    }
    return node.entries;
  });

  mockStatSync.mockImplementation((targetPath: string) => {
    const node = fsMap.get(targetPath);
    if (!node) {
      throw new Error(`ENOENT: ${targetPath}`);
    }

    const stat: MockStat = {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'dir',
    };
    return stat;
  });
}

describe('repo-scanner', () => {
  beforeEach(() => {
    mockReaddirSync.mockReset();
    mockStatSync.mockReset();
  });

  it('finds root-level Dockerfile and marks root dockerfile in repo shape', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [clonePath, { type: 'dir', entries: ['Dockerfile', 'README.md'] }],
      ['/repo/Dockerfile', { type: 'file' }],
      ['/repo/README.md', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath)).toEqual(['/repo/Dockerfile']);

    expect(scanRepoShape(clonePath)).toEqual({
      dockerfiles: ['/repo/Dockerfile'],
      composeFiles: [],
      hasRootDockerfile: true,
    });
  });

  it('finds nested Dockerfiles for monorepo-style paths', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [clonePath, { type: 'dir', entries: ['backend', 'frontend'] }],
      ['/repo/backend', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/frontend', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/backend/Dockerfile', { type: 'file' }],
      ['/repo/frontend/Dockerfile', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath)).toEqual([
      '/repo/backend/Dockerfile',
      '/repo/frontend/Dockerfile',
    ]);
  });

  it('detects root Dockerfile variants with dot suffix and nested Dockerfiles', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [
        clonePath,
        { type: 'dir', entries: ['Dockerfile', 'Dockerfile.api', 'Dockerfile.web', 'apps'] },
      ],
      ['/repo/Dockerfile', { type: 'file' }],
      ['/repo/Dockerfile.api', { type: 'file' }],
      ['/repo/Dockerfile.web', { type: 'file' }],
      ['/repo/apps', { type: 'dir', entries: ['api'] }],
      ['/repo/apps/api', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/apps/api/Dockerfile', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath)).toEqual([
      '/repo/apps/api/Dockerfile',
      '/repo/Dockerfile',
      '/repo/Dockerfile.api',
      '/repo/Dockerfile.web',
    ]);
  });

  it('respects maxDepth when scanning Dockerfiles', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [clonePath, { type: 'dir', entries: ['level1'] }],
      ['/repo/level1', { type: 'dir', entries: ['level2'] }],
      ['/repo/level1/level2', { type: 'dir', entries: ['level3'] }],
      ['/repo/level1/level2/level3', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/level1/level2/level3/Dockerfile', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath, 2)).toEqual([]);
    expect(findDockerfiles(clonePath, 3)).toEqual(['/repo/level1/level2/level3/Dockerfile']);
  });

  it('excludes hidden directories, node_modules, and vendor', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [clonePath, { type: 'dir', entries: ['.git', 'node_modules', 'vendor', 'app'] }],
      ['/repo/.git', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/node_modules', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/vendor', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/app', { type: 'dir', entries: ['Dockerfile'] }],
      ['/repo/.git/Dockerfile', { type: 'file' }],
      ['/repo/node_modules/Dockerfile', { type: 'file' }],
      ['/repo/vendor/Dockerfile', { type: 'file' }],
      ['/repo/app/Dockerfile', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath)).toEqual(['/repo/app/Dockerfile']);
  });

  it('returns empty arrays for an empty directory and detects compose files at root', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([[clonePath, { type: 'dir', entries: [] }]]);
    wireFsMap(fsMap);

    expect(findDockerfiles(clonePath)).toEqual([]);
    expect(scanRepoShape(clonePath)).toEqual({
      dockerfiles: [],
      composeFiles: [],
      hasRootDockerfile: false,
    });
  });

  it('detects root compose files in repo shape', () => {
    const clonePath = '/repo';
    const fsMap = createFsMap([
      [clonePath, { type: 'dir', entries: ['backend'] }],
      ['/repo/backend', { type: 'dir', entries: [] }],
      ['/repo/docker-compose.yml', { type: 'file' }],
      ['/repo/compose.yaml', { type: 'file' }],
    ]);
    wireFsMap(fsMap);

    expect(scanRepoShape(clonePath)).toEqual({
      dockerfiles: [],
      composeFiles: ['/repo/docker-compose.yml', '/repo/compose.yaml'],
      hasRootDockerfile: false,
    });
  });
});
