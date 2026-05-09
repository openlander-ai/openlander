import { execSync } from 'node:child_process';

import { authHeaders, OPENLANDER_URL } from './fixtures/config.js';

const TEST_REPOS = [
  'test-single-dockerfile',
  'test-no-dockerfile',
  'test-compose-multi',
  'test-monorepo',
  'test-build-fail',
  'test-runtime-crash',
  'test-env-required',
];

async function issueApiTokenFromPassword(): Promise<void> {
  const loginRes = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'e2e-quality-gate' }),
  });
  if (!loginRes.ok) {
    throw new Error(`Unable to log in for quality-gate auth (${loginRes.status})`);
  }

  const cookies = loginRes.headers.get('set-cookie') ?? '';
  const sessionMatch = cookies.match(/ol_session=([^;]*)/);
  const sessionToken = sessionMatch?.[1];
  if (!sessionToken) {
    throw new Error('Login succeeded but no ol_session cookie was returned');
  }

  const tokenRes = await fetch(`${OPENLANDER_URL}/api/auth/token`, {
    headers: { Cookie: `ol_session=${sessionToken}` },
  });
  if (!tokenRes.ok) {
    throw new Error(`Unable to issue quality-gate API token (${tokenRes.status})`);
  }

  const tokenData = (await tokenRes.json()) as { token?: string };
  if (!tokenData.token) {
    throw new Error('Token endpoint returned no token for quality-gate auth');
  }
  process.env.OPENLANDER_API_TOKEN = tokenData.token;
}

export default async function globalSetup() {
  console.log('🔍 Running quality-gate precondition checks...\n');

  console.log('  ✓ Checking OpenLander at', OPENLANDER_URL);
  const statusRes = await fetch(`${OPENLANDER_URL}/api/setup/status`);
  const status = (await statusRes.json()) as { hasPassword?: boolean };
  let setupApiToken: string | undefined;

  if (!status.hasPassword) {
    const setupSecret = process.env.OPENLANDER_SETUP_SECRET;
    const setupRes = await fetch(`${OPENLANDER_URL}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'e2e-quality-gate', setupSecret }),
    });
    const setupData = (await setupRes.json()) as { apiToken?: string };
    if (setupData.apiToken) {
      setupApiToken = setupData.apiToken;
    }
  }

  const unauthenticatedProjectsRes = await fetch(`${OPENLANDER_URL}/api/projects`);
  if (unauthenticatedProjectsRes.ok) {
    process.env.OPENLANDER_E2E_NO_AUTH = '1';
  } else if (setupApiToken && !process.env.OPENLANDER_API_TOKEN) {
    process.env.OPENLANDER_API_TOKEN = setupApiToken;
  }

  if (!process.env.OPENLANDER_E2E_NO_AUTH && !process.env.OPENLANDER_API_TOKEN) {
    await issueApiTokenFromPassword();
  }

  const projectsRes = await fetch(`${OPENLANDER_URL}/api/projects`, { headers: authHeaders() });
  if (!projectsRes.ok) {
    throw new Error(`OpenLander API not accessible (${projectsRes.status})`);
  }

  // Check 2: Docker daemon is accessible
  console.log('  ✓ Checking Docker daemon');
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch {
    throw new Error('Docker daemon not accessible');
  }

  // Check 3: Test repositories are accessible
  console.log('  ✓ Checking test repositories');
  const inaccessibleRepos: string[] = [];
  for (const repo of TEST_REPOS) {
    try {
      execSync(`git ls-remote https://github.com/openlander-ai/${repo}`, {
        stdio: 'pipe',
      });
    } catch {
      inaccessibleRepos.push(repo);
    }
  }
  if (inaccessibleRepos.length > 0) {
    throw new Error(`Test repositories inaccessible: ${inaccessibleRepos.join(', ')}`);
  }

  // Check 4: cloudflared (optional)
  console.log('  ✓ Checking cloudflared');
  try {
    execSync('which cloudflared', { stdio: 'pipe' });
  } catch {
    console.warn('  ⚠️  cloudflared not found — tunnel tests will be skipped');
  }

  console.log('\n✅ All preconditions met\n');
}
