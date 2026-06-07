import { createModuleLogger } from '../lib/logger.js';
import type { Database } from '../db/index.js';
import type { RuntimeBackend } from './runtime/index.js';
import { checkEnvRequirements } from './env-inject.js';
import { scanUsedPorts, clearPortScanCache } from './port.js';
import { detectReverseProxy, getProxyStatus } from './traefik.js';
import { getSystemStats } from '../monitor/stats.js';
import { PreflightCheckError } from '../errors.js';
import { getPolicy } from '../config/index.js';
import { containerName as projectContainerName } from './helpers.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const log = createModuleLogger('preflight');

export interface PreflightCheck {
  pass: boolean;
  detail: string;
}

export interface PreflightResult {
  pass: boolean;
  checks: {
    portAvailable: PreflightCheck;
    nameAvailable: PreflightCheck;
    resourceOk: PreflightCheck;
    proxyReady: PreflightCheck;
    envConfigured: PreflightCheck;
    dockerfileSyntax: PreflightCheck;
  };
  warnings: string[];
}

export interface PreflightOptions {
  projectPath?: string;
  dockerfilePath?: string;
  configuredEnvVars?: Record<string, string>;
}

const DISK_FAIL_THRESHOLD_GB = 0.5;
const DISK_WARNING_THRESHOLD_GB = 1;
const MEMORY_WARNING_THRESHOLD_PERCENT = 90;

async function runEnvVarCompletenessCheck(
  db: Database,
  projectName: string,
  options: PreflightOptions,
  warnings: string[],
): Promise<PreflightCheck> {
  const configuredEnvVars =
    options.configuredEnvVars ?? (await getProjectEnvVarsByName(db, projectName));
  const envCheckResult = checkEnvRequirements(
    options.projectPath ?? process.cwd(),
    configuredEnvVars,
  );

  if (envCheckResult.templateFile === null) {
    return {
      pass: true,
      detail: '.env.example not found (env completeness check skipped)',
    };
  }

  if (envCheckResult.required.length === 0) {
    return {
      pass: true,
      detail: '.env.example present but contains no env keys',
    };
  }

  if (envCheckResult.missing.length > 0) {
    warnings.push(
      `Missing env vars from ${envCheckResult.templateFile}: ${envCheckResult.missing.join(', ')}`,
    );
    return {
      pass: true,
      detail: `${envCheckResult.templateFile} missing required keys: ${envCheckResult.missing.join(', ')}`,
    };
  }

  return {
    pass: true,
    detail: `${envCheckResult.templateFile}: all required keys configured (${String(envCheckResult.provided.length)}/${String(envCheckResult.required.length)})`,
  };
}

async function getProjectEnvVarsByName(
  db: Database,
  projectName: string,
): Promise<Record<string, string>> {
  const project = await db.getProjectByName(projectName);
  if (!project) {
    return {};
  }
  return db.getEnvVars(project.id);
}

function runDockerfileSyntaxSanityCheck(
  options: PreflightOptions,
  warnings: string[],
): PreflightCheck {
  const dockerfilePath = join(
    options.projectPath ?? process.cwd(),
    options.dockerfilePath ?? 'Dockerfile',
  );
  if (!existsSync(dockerfilePath)) {
    return {
      pass: true,
      detail: 'Dockerfile not found (syntax sanity check skipped)',
    };
  }

  const dockerfile = readFileSync(dockerfilePath, 'utf8');
  const syntaxWarnings: string[] = [];

  const hasFrom = /^\s*FROM\b/im.test(dockerfile);
  if (!hasFrom) {
    syntaxWarnings.push('Dockerfile is missing FROM instruction');
  }

  const hasCmdOrEntrypoint = /^\s*(CMD|ENTRYPOINT)\b/im.test(dockerfile);
  if (!hasCmdOrEntrypoint) {
    syntaxWarnings.push('Dockerfile is missing CMD or ENTRYPOINT');
  }

  const hasFromScratch = /^\s*FROM\s+scratch(?:\s+AS\s+\S+)?\s*$/im.test(dockerfile);
  const hasCopyOrAdd = /^\s*(COPY|ADD)\b/im.test(dockerfile);
  if (hasFromScratch && !hasCopyOrAdd) {
    syntaxWarnings.push('Dockerfile uses FROM scratch but has no COPY/ADD instruction');
  }

  if (syntaxWarnings.length > 0) {
    warnings.push(...syntaxWarnings);
    return {
      pass: true,
      detail: syntaxWarnings.join('; '),
    };
  }

  return {
    pass: true,
    detail: 'Dockerfile syntax sanity check passed',
  };
}

export async function preflightCheck(
  db: Database,
  runtime: RuntimeBackend,
  projectName: string,
  targetPort?: number,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  log.info({ projectName, targetPort }, 'Running preflight check');

  const warnings: string[] = [];
  const containerName = projectContainerName(projectName);

  try {
    clearPortScanCache();

    const [portScanResult, allContainers, proxyDetection, systemStats] = await Promise.all([
      scanUsedPorts(db, runtime),
      runtime.listAllContainers(),
      detectReverseProxy(runtime),
      Promise.resolve(getSystemStats()).catch(() => null),
    ]);

    const portScan = portScanResult;
    // Port availability check
    let portCheck: PreflightCheck;
    if (targetPort !== undefined) {
      const portInUse = portScan.all.includes(targetPort);
      if (portInUse) {
        const conflictContainer = allContainers.find((c) =>
          c.ports.some((p) => p.PublicPort === targetPort),
        );
        const conflictSource =
          conflictContainer?.name ??
          (portScan.db.includes(targetPort) ? 'OpenLander project' : 'OS process');
        const managedInfo = conflictContainer?.managedByOpenLander ? '' : ' (external)';

        portCheck = {
          pass: false,
          detail: `Port ${String(targetPort)} is already in use by "${conflictSource}"${managedInfo}`,
        };
      } else {
        portCheck = {
          pass: true,
          detail: `Port ${String(targetPort)} is available`,
        };
      }
    } else {
      const { portRangeStart, portRangeEnd } = getPolicy('production');
      const totalRange = portRangeEnd - portRangeStart + 1;
      const hasAvailablePort = portScan.all.length < totalRange;
      portCheck = {
        pass: hasAvailablePort,
        detail: hasAvailablePort
          ? `Ports available in range ${String(portRangeStart)}-${String(portRangeEnd)}`
          : 'No ports available in allocation range',
      };
    }

    // Name availability check
    const existingContainer = allContainers.find((c) => c.name === containerName);
    const nameCheck: PreflightCheck = existingContainer
      ? {
          pass: false,
          detail: `Container "${containerName}" already exists (${existingContainer.managedByOpenLander ? 'managed' : 'external'}, ${existingContainer.state}). If this is an existing OpenLander service, use openlander_service.update_app to update it. Otherwise remove the conflicting container first.`,
        }
      : {
          pass: true,
          detail: `Name "${containerName}" is available`,
        };

    // Resource status check (warning only)
    const resourceWarnings: string[] = [];
    const diskFreeGB = systemStats?.disk ? systemStats.disk.freeGB : 999;
    const mem = systemStats?.memory;
    const memUsedGB = mem ? (mem.usedMB / 1024).toFixed(1) : '?';
    const memTotalGB = mem ? (mem.totalMB / 1024).toFixed(1) : '?';
    const memFreeGB = mem ? (mem.freeMB / 1024).toFixed(1) : '?';
    const memoryUsagePercent = mem ? mem.usagePercent : 0;

    if (diskFreeGB < DISK_WARNING_THRESHOLD_GB) {
      resourceWarnings.push(`Disk space low: ${diskFreeGB.toFixed(1)}GB free (builds may fail)`);
    }
    if (memoryUsagePercent >= MEMORY_WARNING_THRESHOLD_PERCENT) {
      resourceWarnings.push(
        `Memory high: ${memUsedGB}GB / ${memTotalGB}GB (${memoryUsagePercent.toFixed(0)}%) - ${memFreeGB}GB available`,
      );
    }

    const diskCritical = diskFreeGB < DISK_FAIL_THRESHOLD_GB;
    const resourceCheck: PreflightCheck = {
      pass: !diskCritical,
      detail: diskCritical
        ? `Disk space critically low: ${diskFreeGB.toFixed(1)}GB free (need ${String(DISK_FAIL_THRESHOLD_GB)}GB minimum). Run 'docker system prune' to free space.`
        : resourceWarnings.length > 0
          ? resourceWarnings.join('; ')
          : `Disk: ${diskFreeGB.toFixed(1)}GB free, Memory: ${memUsedGB}GB / ${memTotalGB}GB (${memoryUsagePercent.toFixed(0)}%) - ${memFreeGB}GB available`,
    };

    warnings.push(...resourceWarnings);

    const envVarCheck = await runEnvVarCompletenessCheck(db, projectName, options, warnings);
    const dockerfileCheck = runDockerfileSyntaxSanityCheck(options, warnings);

    // Proxy ready check
    let proxyCheck: PreflightCheck;
    const traefikMode = 'managed';
    const proxyStatus = getProxyStatus(proxyDetection, traefikMode);

    if (proxyDetection.type === 'none') {
      proxyCheck = {
        pass: true,
        detail: 'No reverse proxy detected (OpenLander will start Traefik)',
      };
    } else if (proxyDetection.type === 'traefik') {
      if (proxyDetection.traefikDockerProvider === false) {
        proxyCheck = {
          pass: true,
          detail: proxyStatus,
        };
        warnings.push(
          `Traefik detected (${proxyDetection.container ?? 'unknown'}) but Docker provider may not be enabled. ` +
            `Ensure '--providers.docker=true' is set for automatic routing.`,
        );
      } else {
        proxyCheck = {
          pass: true,
          detail: proxyStatus,
        };
      }
    } else {
      proxyCheck = {
        pass: true,
        detail: proxyStatus,
      };
      warnings.push(
        `${proxyDetection.type.charAt(0).toUpperCase() + proxyDetection.type.slice(1)} detected (${proxyDetection.container ?? 'unknown'}). ` +
          `OpenLander will not automatically configure this proxy.`,
      );
    }

    const allPassed = portCheck.pass && nameCheck.pass && resourceCheck.pass;
    const result: PreflightResult = {
      pass: allPassed,
      checks: {
        portAvailable: portCheck,
        nameAvailable: nameCheck,
        resourceOk: resourceCheck,
        proxyReady: proxyCheck,
        envConfigured: envVarCheck,
        dockerfileSyntax: dockerfileCheck,
      },
      warnings,
    };

    log.info(
      {
        projectName,
        pass: result.pass,
        portPass: portCheck.pass,
        namePass: nameCheck.pass,
        warningCount: warnings.length,
      },
      'Preflight check completed',
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ error, projectName }, 'Preflight check failed');

    return {
      pass: false,
      checks: {
        portAvailable: { pass: false, detail: `Preflight error: ${errorMsg}` },
        nameAvailable: { pass: false, detail: `Preflight error: ${errorMsg}` },
        resourceOk: { pass: false, detail: `Preflight error: ${errorMsg}` },
        proxyReady: { pass: false, detail: `Preflight error: ${errorMsg}` },
        envConfigured: { pass: false, detail: `Preflight error: ${errorMsg}` },
        dockerfileSyntax: { pass: false, detail: `Preflight error: ${errorMsg}` },
      },
      warnings: [`Preflight check failed: ${errorMsg}`],
    };
  }
}

export async function preflightCheckOrThrow(
  db: Database,
  runtime: RuntimeBackend,
  projectName: string,
  targetPort?: number,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const result = await preflightCheck(db, runtime, projectName, targetPort, options);

  if (!result.pass) {
    throw new PreflightCheckError(result);
  }

  return result;
}

export function formatPreflightResult(result: PreflightResult): string {
  const lines: string[] = ['Preflight check:'];

  const checkIcons = (pass: boolean) => (pass ? '✅' : '❌');
  const warnIcon = '⚠️';

  lines.push(
    `  ${checkIcons(result.checks.portAvailable.pass)} ${result.checks.portAvailable.detail}`,
  );
  lines.push(
    `  ${checkIcons(result.checks.nameAvailable.pass)} ${result.checks.nameAvailable.detail}`,
  );
  lines.push(`  ${checkIcons(result.checks.resourceOk.pass)} ${result.checks.resourceOk.detail}`);
  lines.push(`  ${checkIcons(result.checks.proxyReady.pass)} ${result.checks.proxyReady.detail}`);
  lines.push(
    `  ${checkIcons(result.checks.envConfigured.pass)} ${result.checks.envConfigured.detail}`,
  );
  lines.push(
    `  ${checkIcons(result.checks.dockerfileSyntax.pass)} ${result.checks.dockerfileSyntax.detail}`,
  );

  if (result.warnings.length > 0) {
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`  ${warnIcon} ${warning}`);
    }
  }

  if (result.pass) {
    lines.push('');
    lines.push('All clear. Proceeding with deployment...');
  }

  return lines.join('\n');
}

export function formatPreflightFailure(result: PreflightResult): string {
  const lines: string[] = ['❌ Deployment blocked:'];

  const failedChecks = Object.entries(result.checks)
    .filter(([, check]) => !check.pass)
    .map(([name, check]) => {
      const friendlyName = name.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `  ❌ ${friendlyName}: ${check.detail}`;
    });

  lines.push(...failedChecks);

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Additional warnings:');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join('\n');
}
