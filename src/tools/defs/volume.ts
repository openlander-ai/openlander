import { createModuleLogger } from '../../lib/logger.js';
import {
  addVolumeSchema,
  cleanupDockerSchema,
  getDiskUsageSchema,
  listVolumesSchema,
  removeVolumeSchema,
} from './schemas.js';
import { pruneBuildCache, pruneDanglingImages, pruneUnusedImages } from '../../pipeline/cleanup.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-volume');

function getDockerVolumeName(projectName: string, volumeName: string): string {
  return `ol-vol-${projectName}-${volumeName}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getLabels(volume: unknown): Record<string, string> {
  if (!isRecord(volume)) {
    return {};
  }

  const rawLabels = volume['Labels'];
  if (!isRecord(rawLabels)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (typeof value === 'string') {
      labels[key] = value;
    }
  }

  return labels;
}

function getVolumeUsageSizeBytes(volume: unknown): number | undefined {
  if (!isRecord(volume)) {
    return undefined;
  }

  const usageData = volume['UsageData'];
  if (!isRecord(usageData)) {
    return undefined;
  }

  return getNumber(usageData['Size']);
}

export const volumeToolDefs: ToolDef[] = [
  {
    name: 'add_volume',
    description:
      'Create a Docker named volume managed by OpenLander for a project. Use when an app needs persistent data storage at a specific mount path (for uploads, caches, or generated files). Returns { status, volume, project, mount_path }. Errors if the volume already exists.',
    mcpDescription: 'Create a project-scoped managed Docker volume with metadata labels.',
    inputSchema: addVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const mountPath = args['mount_path'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      const client = appCtx.docker.getClient();

      // Docker createVolume is idempotent — it silently returns existing volumes.
      // We must inspect first to detect duplicates and reject foreign volumes.
      try {
        const existing = await client.getVolume(dockerVolumeName).inspect();
        const existingLabels = getLabels(existing);
        if (existingLabels['openlander.managed'] === 'true') {
          throw new Error(
            `Volume "${dockerVolumeName}" already exists for project "${projectName}". Use a different volume_name or remove the existing volume first.`,
          );
        }
        throw new Error(
          `A Docker volume named "${dockerVolumeName}" already exists but is not managed by OpenLander. Choose a different volume_name to avoid conflicts.`,
        );
      } catch (error) {
        const message = getErrorMessage(error);
        // 404 = volume doesn't exist → safe to create
        if (!message.includes('no such volume') && !message.includes('No such volume')) {
          throw error;
        }
      }

      try {
        await client.createVolume({
          Name: dockerVolumeName,
          Labels: {
            'openlander.managed': 'true',
            'openlander.role': 'volume',
            'openlander.project': projectName,
            'openlander.volume': volumeName,
            'openlander.mount_path': mountPath,
          },
        });
      } catch (error) {
        throw new Error(`Failed to create volume "${dockerVolumeName}": ${getErrorMessage(error)}`);
      }

      return {
        status: 'created',
        volume: dockerVolumeName,
        project: projectName,
        mount_path: mountPath,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_volumes',
    description:
      'List OpenLander-managed Docker volumes. Optionally filter by project name. Returns { count, volumes[] } where each volume includes Docker name, project, logical volume name, mount path, and sizeBytes when available from Docker usage data.',
    mcpDescription: 'List OpenLander-managed volumes with project metadata and optional sizes.',
    inputSchema: listVolumesSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;
      const client = appCtx.docker.getClient();

      const labels = projectName
        ? ['openlander.managed=true', 'openlander.role=volume', `openlander.project=${projectName}`]
        : ['openlander.managed=true', 'openlander.role=volume'];

      const result = await client.listVolumes({ filters: { label: labels } });
      const listedVolumes = Array.isArray(result.Volumes) ? result.Volumes : [];

      const volumes = await Promise.all(
        listedVolumes.map(async (volumeInfo) => {
          const fallbackLabels = getLabels(volumeInfo);
          const name = getString(volumeInfo.Name) ?? '';

          let sizeBytes = getVolumeUsageSizeBytes(volumeInfo);
          let labelsFromInspect = fallbackLabels;

          if (name) {
            try {
              const inspectedVolume = await client.getVolume(name).inspect();
              sizeBytes = getVolumeUsageSizeBytes(inspectedVolume) ?? sizeBytes;
              const inspectedLabels = getLabels(inspectedVolume);
              if (Object.keys(inspectedLabels).length > 0) {
                labelsFromInspect = inspectedLabels;
              }
            } catch (error) {
              log.warn(
                { err: error, volume: name },
                'Failed to inspect Docker volume for usage data',
              );
            }
          }

          return {
            name,
            project: labelsFromInspect['openlander.project'] ?? null,
            volumeName: labelsFromInspect['openlander.volume'] ?? null,
            mountPath: labelsFromInspect['openlander.mount_path'] ?? null,
            ...(sizeBytes !== undefined ? { sizeBytes } : {}),
          };
        }),
      );

      return {
        count: volumes.length,
        volumes,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'remove_volume',
    description:
      'Remove a managed project volume and permanently delete all data inside it. Use only when data is no longer needed. Returns { status, volume, warning }. If the volume is in use, stop containers first, then retry.',
    mcpDescription: 'Remove a managed volume. Data deletion is permanent.',
    inputSchema: removeVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      const client = appCtx.docker.getClient();
      const volume = client.getVolume(dockerVolumeName);

      let inspected: unknown;
      try {
        inspected = await volume.inspect();
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.includes('no such volume') || message.includes('No such volume')) {
          throw new Error(
            `Volume "${dockerVolumeName}" not found. Check project_name and volume_name.`,
          );
        }
        throw new Error(`Failed to inspect volume "${dockerVolumeName}": ${message}`);
      }

      const labels = getLabels(inspected);
      if (labels['openlander.managed'] !== 'true' || labels['openlander.role'] !== 'volume') {
        throw new Error(
          `Volume "${dockerVolumeName}" exists but is not an OpenLander-managed volume. Refusing to delete.`,
        );
      }

      try {
        await volume.remove();
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.toLowerCase().includes('in use')) {
          throw new Error(
            `Volume "${dockerVolumeName}" is currently in use by a container. Stop the container first, then retry remove_volume.`,
          );
        }
        throw new Error(`Failed to remove volume "${dockerVolumeName}": ${message}`);
      }

      return {
        status: 'removed',
        volume: dockerVolumeName,
        warning: 'All data in this volume has been permanently deleted.',
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'get_disk_usage',
    description:
      'Get Docker system disk usage breakdown for images, containers, and volumes. Includes a separate list of OpenLander-managed volumes with per-volume size when available. Returns counts and total sizes in bytes.',
    mcpDescription: 'Get Docker disk usage totals and managed volume sizes.',
    inputSchema: getDiskUsageSchema,
    execute: async (_args, { appCtx }) => {
      const diskUsageData: unknown = await appCtx.docker.getClient().df();
      if (!isRecord(diskUsageData)) {
        return {
          images: { count: 0, totalSizeBytes: 0 },
          containers: { count: 0, totalSizeBytes: 0 },
          volumes: { count: 0, totalSizeBytes: 0, managed: [] },
        };
      }

      const imagesRaw: unknown[] = Array.isArray(diskUsageData['Images'])
        ? (diskUsageData['Images'] as unknown[])
        : [];
      const containersRaw: unknown[] = Array.isArray(diskUsageData['Containers'])
        ? (diskUsageData['Containers'] as unknown[])
        : [];
      const volumesRaw: unknown[] = Array.isArray(diskUsageData['Volumes'])
        ? (diskUsageData['Volumes'] as unknown[])
        : [];

      const imageTotalSizeBytes = imagesRaw.reduce<number>((sum, image) => {
        if (!isRecord(image)) {
          return sum;
        }
        return sum + (getNumber(image['Size']) ?? 0);
      }, 0);

      const containerTotalSizeBytes = containersRaw.reduce<number>((sum, container) => {
        if (!isRecord(container)) {
          return sum;
        }
        return sum + (getNumber(container['SizeRw']) ?? 0);
      }, 0);

      const volumeTotalSizeBytes = volumesRaw.reduce<number>((sum, volume) => {
        return sum + (getVolumeUsageSizeBytes(volume) ?? 0);
      }, 0);

      const managedVolumes = volumesRaw
        .filter((volume) => {
          const labels = getLabels(volume);
          return labels['openlander.managed'] === 'true';
        })
        .map((volume) => {
          const labels = getLabels(volume);
          const name = isRecord(volume) ? (getString(volume['Name']) ?? '') : '';
          const sizeBytes = getVolumeUsageSizeBytes(volume) ?? 0;
          return {
            name,
            ...(labels['openlander.project'] ? { project: labels['openlander.project'] } : {}),
            sizeBytes,
          };
        });

      return {
        images: {
          count: imagesRaw.length,
          totalSizeBytes: imageTotalSizeBytes,
        },
        containers: {
          count: containersRaw.length,
          totalSizeBytes: containerTotalSizeBytes,
        },
        volumes: {
          count: volumesRaw.length,
          totalSizeBytes: volumeTotalSizeBytes,
          managed: managedVolumes,
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'cleanup_docker',
    description:
      'Free Docker disk space by removing dangling images, build cache, and unused images. Host-wide operation — affects all Docker workloads, not just OpenLander projects. Use when disk is running low, Docker builds fail with storage errors, or user asks to clean up. Workflow: get_disk_usage → cleanup_docker → get_disk_usage to show reclaimed space. Three levels: "soft" removes only dangling (untagged) images. "standard" (default) also clears build cache — may slow the next build. "aggressive" additionally removes all unused images older than 24h — frees the most space but removes cached base images and possibly stored rollback images. Does NOT remove running containers, mounted volumes, or images referenced by a container.',
    mcpDescription:
      'Free Docker disk space by pruning dangling images, build cache, and unused images. Host-wide — affects all Docker workloads on this host. Recommended workflow: call get_disk_usage first, then cleanup_docker, then get_disk_usage again to report reclaimed space. Levels: "soft" (dangling images only), "standard" (default — also clears build cache, may slow next build), "aggressive" (also removes unused images older than 24h, may remove rollback images). Does NOT remove running containers, mounted volumes, or in-use images.',
    inputSchema: cleanupDockerSchema,
    execute: (args, { appCtx }) => {
      const level = (args['level'] as string | undefined) ?? 'standard';
      const warnings: string[] = [];
      let totalReclaimedMB = 0;

      if (level !== 'soft') {
        const building = appCtx.db.listProjects('building');
        if (building.length > 0) {
          return {
            level,
            skipped: true,
            reason: `${String(building.length)} project(s) currently building. Run cleanup after builds complete, or use level "soft" (dangling images only) which is safe during builds.`,
          };
        }
      }

      const dangling = pruneDanglingImages();
      totalReclaimedMB += dangling.reclaimedMB;

      let buildCache: ReturnType<typeof pruneBuildCache> | undefined;
      if (level === 'standard' || level === 'aggressive') {
        buildCache = pruneBuildCache();
        totalReclaimedMB += buildCache.reclaimedMB;
        if (buildCache.status === 'ok' && buildCache.reclaimedMB > 0) {
          warnings.push('Build cache cleared — next build may be slower due to cache miss.');
        }
      }

      let unusedImages: ReturnType<typeof pruneUnusedImages> | undefined;
      if (level === 'aggressive') {
        unusedImages = pruneUnusedImages();
        totalReclaimedMB += unusedImages.reclaimedMB;
        if (unusedImages.status === 'ok' && unusedImages.removed > 0) {
          warnings.push(
            'Unused images removed — rollback to a previous version may require re-pulling the image.',
          );
        }
      }

      totalReclaimedMB = Math.round(totalReclaimedMB * 100) / 100;
      log.info({ level, totalReclaimedMB }, 'Docker cleanup completed via MCP');

      return {
        level,
        danglingImages: dangling,
        ...(buildCache ? { buildCache } : {}),
        ...(unusedImages ? { unusedImages } : {}),
        totalReclaimedMB,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
    targets: ['mcp'],
  },
];
