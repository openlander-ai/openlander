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

  // Check 1: OpenLander is reachable
  console.log('  ✓ Checking OpenLander at', OPENLANDER_URL);
  try {
    const response = await fetch(`${OPENLANDER_URL}/api/projects`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    throw new Error(`OpenLander not reachable at ${OPENLANDER_URL}`);
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
