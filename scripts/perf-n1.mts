/* eslint-disable no-console */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDrizzleDatabase } from '../src/db/drizzle.js';
import { EnvironmentRepo } from '../src/db/repos/environment.repo.js';
import { ProjectRepo } from '../src/db/repos/project.repo.js';

const { sqlite, db } = createDrizzleDatabase(':memory:');
migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
const repo = new ProjectRepo(db, sqlite);
const envRepo = new EnvironmentRepo(db, sqlite);

const N = Number(process.env.N ?? '100');
for (let i = 0; i < N; i++) {
  const id = `p-${String(i)}`;
  repo.createProject({ id, name: `proj-${String(i)}`, repoUrl: `https://x/${String(i)}` });
  envRepo.createEnvironment({
    id: `${id}-prod`,
    projectId: id,
    type: 'production',
    branch: 'main',
  });
}

let queryCount = 0;
const origPrepare = sqlite.prepare.bind(sqlite);
(sqlite as unknown as { prepare: typeof origPrepare }).prepare = (sql: string) => {
  queryCount += 1;
  return origPrepare(sql);
};

queryCount = 0;
const legacyStart = process.hrtime.bigint();
const projects = repo.listProjects();
for (const p of projects) {
  envRepo.getEnvironmentsByProject(p.id);
  repo.isParentProject(p.id);
  repo.getChildProjects(p.id);
}
const legacyMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;
const legacyQ = queryCount;

queryCount = 0;
const batchStart = process.hrtime.bigint();
repo.listProjectsWithMetadata();
const batchMs = Number(process.hrtime.bigint() - batchStart) / 1e6;
const batchQ = queryCount;

console.log(`Projects seeded: ${String(N)}`);
console.log(`Legacy (N+1):    ${String(legacyQ)} prepared queries, ${legacyMs.toFixed(2)}ms`);
console.log(`Batched:         ${String(batchQ)} prepared queries, ${batchMs.toFixed(2)}ms`);
console.log(
  `Reduction:       ${String(legacyQ - batchQ)} fewer queries (${(
    (1 - batchQ / legacyQ) *
    100
  ).toFixed(1)}% drop)`,
);
console.log(`Speedup:         ${(legacyMs / batchMs).toFixed(2)}x`);
