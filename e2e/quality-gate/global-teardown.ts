import { execSync } from 'node:child_process';

const OPENLANDER_URL = 'http://localhost:10114';

export default async function globalTeardown() {
  console.log('\n🧹 Running quality-gate cleanup...\n');

  try {
    // Fetch all projects
    const response = await fetch(`${OPENLANDER_URL}/api/projects`);
    if (!response.ok) {
      console.warn(`⚠️  Failed to fetch projects: HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { projects?: Array<{ id: string; name: string }> };
    const projects = data.projects ?? [];

    // Filter projects with test- prefix
    const testProjects = projects.filter((p) => p.name.includes('test-'));

    if (testProjects.length === 0) {
      console.log('  ✓ No test projects to clean up');
    } else {
      console.log(`  ✓ Found ${testProjects.length} test project(s) to delete`);

      // Delete each test project
      for (const project of testProjects) {
        try {
          const deleteResponse = await fetch(`${OPENLANDER_URL}/api/projects/${project.id}`, {
            method: 'DELETE',
          });
          if (deleteResponse.ok) {
            console.log(`    ✓ Deleted project: ${project.name}`);
          } else {
            console.warn(`    ⚠️  Failed to delete ${project.name}: HTTP ${deleteResponse.status}`);
          }
        } catch (err) {
          console.warn(
            `    ⚠️  Error deleting ${project.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // Clean up orphan Docker containers
    console.log('  ✓ Cleaning up orphan Docker containers');
    try {
      const containerIds = execSync('docker ps -a --filter name=test- -q', {
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);

      if (containerIds.length === 0) {
        console.log('    ✓ No orphan containers found');
      } else {
        console.log(`    ✓ Found ${containerIds.length} orphan container(s)`);
        for (const containerId of containerIds) {
          try {
            execSync(`docker rm -f ${containerId}`, { stdio: 'pipe' });
            console.log(`    ✓ Removed container: ${containerId.slice(0, 12)}`);
          } catch {
            console.warn(`    ⚠️  Failed to remove container: ${containerId.slice(0, 12)}`);
          }
        }
      }
    } catch (err) {
      console.warn(
        '  ⚠️  Docker cleanup failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    console.log('\n✅ Cleanup complete\n');
  } catch (err) {
    console.error('❌ Cleanup failed:', err instanceof Error ? err.message : String(err));
  }
}
