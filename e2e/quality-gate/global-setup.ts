import { execSync } from 'node:child_process';

const OPENLANDER_URL = 'http://localhost:10114';
const TEST_REPOS = [
  'test-single-dockerfile',
  'test-no-dockerfile',
  'test-compose-multi',
  'test-monorepo',
  'test-build-fail',
  'test-runtime-crash',
  'test-env-required',
];

export default async function globalSetup() {
  console.log('🔍 Running quality-gate precondition checks...\n');

  console.log('  ✓ Checking OpenLander at', OPENLANDER_URL);
  const statusRes = await fetch(`${OPENLANDER_URL}/api/setup/status`);
  const status = (await statusRes.json()) as { hasPassword?: boolean };

  if (!status.hasPassword) {
    const setupRes = await fetch(`${OPENLANDER_URL}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'e2e-quality-gate' }),
    });
    const setupData = (await setupRes.json()) as { apiToken?: string };
    if (setupData.apiToken) {
      process.env.OPENLANDER_API_TOKEN = setupData.apiToken;
    }
  }

  if (!process.env.OPENLANDER_API_TOKEN) {
    const loginRes = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'e2e-quality-gate' }),
    });
    const cookies = loginRes.headers.get('set-cookie') ?? '';
    const sessionMatch = cookies.match(/ol_session=([^;]*)/);
    if (sessionMatch) {
      process.env.OPENLANDER_SESSION = sessionMatch[1];
    }
  }

  const authHeader: Record<string, string> = {};
  if (process.env.OPENLANDER_API_TOKEN) {
    authHeader['Authorization'] = `Bearer ${process.env.OPENLANDER_API_TOKEN}`;
  } else if (process.env.OPENLANDER_SESSION) {
    authHeader['Cookie'] = `ol_session=${process.env.OPENLANDER_SESSION}`;
  }

  const projectsRes = await fetch(`${OPENLANDER_URL}/api/projects`, { headers: authHeader });
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
