#!/usr/bin/env node

import { chmod, readFile, rm, writeFile } from 'node:fs/promises';

const [mode, statePath] = process.argv.slice(2);
const baseUrl = (process.env.OPENLANDER_E2E_BASE_URL ?? 'http://localhost:10114').replace(
  /\/$/,
  '',
);
const password = process.env.OPENLANDER_UPGRADE_SMOKE_PASSWORD ?? 'e2e-quality-gate';

if (!['seed', 'verify'].includes(mode) || !statePath) {
  throw new Error('Usage: rc-upgrade-state-smoke.mjs <seed|verify> <state-file>');
}

async function expectOk(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
  return response;
}

async function login() {
  const response = await expectOk(
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
    'Login',
  );
  const sessionToken = /(?:^|[,;]\s*)ol_session=([^;,]*)/.exec(
    response.headers.get('set-cookie') ?? '',
  )?.[1];
  if (!sessionToken) throw new Error('Login returned no ol_session cookie');
  return sessionToken;
}

async function seed() {
  const setupStatus = await expectOk(
    await fetch(`${baseUrl}/api/setup/status`),
    'Setup status',
  ).then((response) => response.json());

  if (!setupStatus.hasPassword) {
    await expectOk(
      await fetch(`${baseUrl}/api/auth/setup-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
      'Password setup',
    );
  }

  const sessionToken = await login();
  const tokenResponse = await expectOk(
    await fetch(`${baseUrl}/api/auth/token`, {
      headers: { Cookie: `ol_session=${sessionToken}` },
    }),
    'API token issue',
  );
  const { token } = await tokenResponse.json();
  if (typeof token !== 'string' || !token.startsWith('ol_')) {
    throw new Error('API token endpoint returned no OpenLander token');
  }

  const markerName = `rc-upgrade-${Date.now().toString(36)}`;
  const createResponse = await expectOk(
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: markerName }),
    }),
    'Upgrade marker creation',
  );
  const created = await createResponse.json();
  const projectId = created.project?.id;
  if (typeof projectId !== 'string') {
    throw new Error('Upgrade marker creation returned no project id');
  }

  await writeFile(statePath, JSON.stringify({ token, projectId, markerName }), { mode: 0o600 });
  await chmod(statePath, 0o600);
  console.log(`Seeded upgrade state with project ${markerName}`);
}

async function verify() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    typeof state.token !== 'string' ||
    typeof state.projectId !== 'string' ||
    typeof state.markerName !== 'string'
  ) {
    throw new Error('Upgrade state file is invalid');
  }

  const setupStatus = await expectOk(
    await fetch(`${baseUrl}/api/setup/status`),
    'Post-upgrade setup status',
  ).then((response) => response.json());
  if (!setupStatus.hasPassword) throw new Error('Password state was not preserved across upgrade');

  await login();
  const projectsResponse = await expectOk(
    await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${state.token}` },
    }),
    'Post-upgrade API token validation',
  );
  const projects = await projectsResponse.json();
  const marker = projects.projects?.find(
    (project) => project.id === state.projectId && project.name === state.markerName,
  );
  if (!marker) throw new Error('Database marker was not preserved across upgrade');

  await expectOk(
    await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(state.projectId)}/purge?confirm=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.token}` },
      },
    ),
    'Upgrade marker cleanup',
  );
  await rm(statePath, { force: true });
  console.log('Verified password, API token, and database state across upgrade');
}

if (mode === 'seed') await seed();
else await verify();
