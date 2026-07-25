import { execSync } from 'node:child_process';

import { authHeaders, OPENLANDER_URL } from './fixtures/config.js';
import {
  E2E_CONTAINER_NAME_PREFIXES,
  listContainerIdsByNamePrefix,
} from './fixtures/docker-cleanup.js';

type ProjectSummary = { id: string; name: string };
type ServiceSummary = { id?: string; name?: string };

const TEST_PROJECT_PATTERN = /^(test-|golden-|qg-|qa-|mcp-)/i;

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string>) };
  return fetch(`${OPENLANDER_URL}${path}`, { ...init, headers });
}

async function listServices(project: ProjectSummary): Promise<ServiceSummary[]> {
  const response = await apiFetch(`/api/projects/${project.id}/services`);
  if (!response.ok) {
    console.warn(`    ⚠️  Failed to list services for ${project.name}: HTTP ${response.status}`);
    return [];
  }
  const data = (await response.json()) as { services?: ServiceSummary[] } | ServiceSummary[];
  return Array.isArray(data) ? data : (data.services ?? []);
}

async function deleteDeployableServices(project: ProjectSummary): Promise<void> {
  const services = await listServices(project);
  for (const service of services) {
    if (!service.id || !service.name) continue;
    const response = await apiFetch(`/api/projects/${project.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: `${project.name}/${service.name}` }),
    });
    if (response.ok) {
      console.log(`    ✓ Deleted service: ${project.name}/${service.name}`);
      continue;
    }
    console.warn(
      `    ⚠️  Failed to delete service ${project.name}/${service.name}: HTTP ${response.status}`,
    );
  }
}

async function deleteManagedServices(project: ProjectSummary): Promise<void> {
  const response = await apiFetch(`/api/projects/${project.id}/managed-services`);
  if (!response.ok) {
    console.warn(
      `    ⚠️  Failed to list managed resources for ${project.name}: HTTP ${response.status}`,
    );
    return;
  }

  const services = (await response.json()) as ServiceSummary[];
  for (const service of services) {
    if (!service.id) continue;
    const detailResponse = await apiFetch(`/api/services/${service.id}`);
    if (!detailResponse.ok) continue;
    const detail = (await detailResponse.json()) as { attached_project_id?: string | null };
    if (detail.attached_project_id !== project.id) continue;

    const deleteResponse = await apiFetch(`/api/services/${service.id}?force=true&confirm=true`, {
      method: 'DELETE',
    });
    if (deleteResponse.ok) {
      console.log(`    ✓ Deleted managed resource: ${project.name}/${service.name ?? service.id}`);
      continue;
    }
    console.warn(
      `    ⚠️  Failed to delete managed resource ${project.name}/${service.name ?? service.id}: HTTP ${deleteResponse.status}`,
    );
  }
}

async function deleteProject(project: ProjectSummary): Promise<void> {
  let response = await apiFetch(`/api/projects/${project.id}/purge?confirm=true`, {
    method: 'DELETE',
  });
  if (response.status === 409) {
    await deleteDeployableServices(project);
    await deleteManagedServices(project);
    response = await apiFetch(`/api/projects/${project.id}/purge?confirm=true`, {
      method: 'DELETE',
    });
  }

  if (response.ok) {
    console.log(`    ✓ Deleted project: ${project.name}`);
    return;
  }
  console.warn(`    ⚠️  Failed to delete ${project.name}: HTTP ${response.status}`);
}

export default async function globalTeardown() {
  console.log('\n🧹 Running quality-gate cleanup...\n');

  try {
    const response = await apiFetch('/api/projects?include_archived=true');
    if (!response.ok) {
      console.warn(`⚠️  Failed to fetch projects: HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { projects?: ProjectSummary[] };
    const projects = data.projects ?? [];
    const isEphemeral = process.env['OPENLANDER_E2E_EPHEMERAL'] === '1';
    const testProjects = projects.filter(
      (project) =>
        TEST_PROJECT_PATTERN.test(project.name) &&
        !(isEphemeral && project.name.startsWith('qg-delivery-live-')),
    );

    if (testProjects.length === 0) {
      console.log('  ✓ No test projects to clean up');
    } else {
      console.log(`  ✓ Found ${testProjects.length} test project(s) to delete`);
      for (const project of testProjects) {
        try {
          await deleteProject(project);
        } catch (err) {
          console.warn(
            `    ⚠️  Error deleting ${project.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log('  ✓ Cleaning up orphan Docker containers');
    try {
      const containerIds = listContainerIdsByNamePrefix(E2E_CONTAINER_NAME_PREFIXES);
      const uniqueContainerIds = Array.from(new Set(containerIds));

      if (uniqueContainerIds.length === 0) {
        console.log('    ✓ No orphan containers found');
      } else {
        console.log(`    ✓ Found ${uniqueContainerIds.length} orphan container(s)`);
        for (const containerId of uniqueContainerIds) {
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
