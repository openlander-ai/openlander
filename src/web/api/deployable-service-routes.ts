import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import type { DeployLogRow } from '../../db/types.js';
import { loadServiceViewRecords } from '../../db/views/service-view.js';
import { ProjectNotFoundError } from '../../errors.js';
import {
  aggregateComposeStatus,
  resolveComposeTrafficTargetId,
  serviceHealthStrategy,
  serviceLifecycle,
} from '../../health/compose-runtime.js';
import { loadComposeTrafficService } from '../../pipeline/config-snapshot.js';
import {
  findService,
  resolveDeployableServiceForRoute,
  resolveProject,
} from './helpers/deployable-service-route-shared.js';
import {
  getAliasedField,
  getDeployableServiceAutoRouteName,
  loadDomainMappingsByService,
  mapEnvironment,
  mapProjectForApi,
  mapServiceForApi,
  parseImageCommandField,
  parseNullableTextField,
} from './helpers/project-route-shared.js';

function gitCredentialSummary(
  credential: Awaited<ReturnType<AppContext['gitCredentials']['get']>>,
) {
  return {
    id: credential.id,
    name: credential.name,
    fingerprint: credential.fingerprint,
    status: credential.status,
  };
}

export function createDeployableServiceRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/services', async (c) => {
    const projectParam = c.req.param('id');
    const includeArchived = c.req.query('include_archived') === 'true';
    const includeComposeChildren = c.req.query('include_compose_children') === 'true';
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      const err = new ProjectNotFoundError(projectParam);
      return c.json(err.toJSON(), err.statusCode as 404);
    }

    const deployablesPromise = includeComposeChildren
      ? ctx.db.getServices({
          project_id: project.id,
          kindNotIn: MANAGED_SERVICE_KINDS,
        })
      : ctx.db.getDeployablesByGroup(project.id);
    const [deployables, environments] = await Promise.all([
      deployablesPromise,
      ctx.db.getEnvironmentsByProject(project.id),
    ]);
    const projectLevelDeployables = deployables.filter(
      (service) => service.kind !== 'compose-child',
    );
    const selectedDeployables = includeComposeChildren ? deployables : projectLevelDeployables;
    const visibleDeployables = includeArchived
      ? selectedDeployables
      : selectedDeployables.filter((service) => !service.archived_at);
    const gitCredentialManager = (ctx as Partial<AppContext>).gitCredentials;
    const lastDeploysPromise: Promise<Map<string, DeployLogRow>> = includeComposeChildren
      ? ctx.db.getLastDeployLogsForServices(visibleDeployables.map((service) => service.id))
      : Promise.resolve(new Map<string, DeployLogRow>());
    const [domainMappingsByService, credentials, lastDeploys] = await Promise.all([
      loadDomainMappingsByService(ctx, visibleDeployables),
      gitCredentialManager ? gitCredentialManager.list() : Promise.resolve([]),
      lastDeploysPromise,
    ]);
    const credentialsById = new Map(credentials.map((credential) => [credential.id, credential]));
    const composeChildren = visibleDeployables.filter(
      (service) => service.kind === 'compose-child',
    );
    const trafficService =
      composeChildren.length > 0 ? await loadComposeTrafficService(ctx.db, project.id) : undefined;
    const trafficTargetId = resolveComposeTrafficTargetId(composeChildren, trafficService);
    const aggregateStatus = aggregateComposeStatus(
      composeChildren,
      new Map([...lastDeploys].map(([id, log]) => [id, log.status])),
    );

    return c.json({
      count: visibleDeployables.length,
      ...(aggregateStatus ? { aggregate_status: aggregateStatus } : {}),
      services: visibleDeployables.map((service) => {
        const credential = service.git_credential_id
          ? credentialsById.get(service.git_credential_id)
          : undefined;
        const lastDeploy = lastDeploys.get(service.id);
        return {
          ...mapServiceForApi(service, environments, {
            domainMappings: domainMappingsByService.get(service.id),
            autoRouteName: getDeployableServiceAutoRouteName(project, service),
          }),
          runtime_role: service.runtime_role,
          lifecycle: serviceLifecycle(service),
          health_strategy: serviceHealthStrategy(service),
          gitCredential: credential ? gitCredentialSummary(credential) : null,
          ...(includeComposeChildren && service.kind === 'compose-child'
            ? {
                is_traffic_target: service.id === trafficTargetId,
                ...(lastDeploy
                  ? {
                      last_deploy: {
                        status: lastDeploy.status,
                        created_at: lastDeploy.created_at,
                      },
                    }
                  : {}),
              }
            : {}),
        };
      }),
    });
  });

  api.get('/projects/:p/services/:s', async (c) => {
    const projectParam = c.req.param('p');
    const serviceParam = c.req.param('s');
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
    }

    const service = await findService(ctx, serviceParam);
    if (service && service.project_id !== project.id) {
      return c.json({ error: 'NOT_FOUND', message: `Service not found: ${serviceParam}` }, 404);
    }
    const envVars = service
      ? await ctx.env.getAllForService(project.id, service.id)
      : await ctx.env.getAll(project.id);
    const gitCredentialManager = (ctx as Partial<AppContext>).gitCredentials;
    const [
      environments,
      deployLogs,
      serviceRecords,
      domainMappingsByService,
      gitCredential,
      composeSiblings,
    ] = await Promise.all([
      ctx.db.getEnvironmentsByProject(project.id),
      service ? ctx.db.getDeployLogsForService(service.id, 5) : ctx.db.getDeployLogs(project.id, 5),
      loadServiceViewRecords(ctx.db, [project]),
      loadDomainMappingsByService(ctx, service ? [service] : []),
      service?.git_credential_id && gitCredentialManager
        ? gitCredentialManager.get(service.git_credential_id)
        : null,
      service?.kind === 'compose-child' && service.parent_service_id
        ? ctx.db.getComposeChildren(service.parent_service_id)
        : Promise.resolve([]),
    ]);
    const detailTrafficCandidates = composeSiblings.filter(
      (sibling) => sibling.runtime_role === 'application' && sibling.assigned_port != null,
    );
    const detailTrafficTargetId =
      detailTrafficCandidates.length === 1 ? detailTrafficCandidates[0]?.id : undefined;

    return c.json({
      ...mapProjectForApi(project, serviceRecords.get(project.id)?.service ?? undefined),
      service: service
        ? {
            ...mapServiceForApi(service, environments, {
              domainMappings: domainMappingsByService.get(service.id),
              autoRouteName: getDeployableServiceAutoRouteName(project, service),
            }),
            runtime_role: service.runtime_role,
            lifecycle: serviceLifecycle(service),
            health_strategy: serviceHealthStrategy(service),
            gitCredential: gitCredential ? gitCredentialSummary(gitCredential) : null,
            ...(service.kind === 'compose-child'
              ? {
                  is_traffic_target: service.id === detailTrafficTargetId,
                  ...(deployLogs[0]
                    ? {
                        last_deploy: {
                          status: deployLogs[0].status,
                          created_at: deployLogs[0].created_at,
                        },
                      }
                    : {}),
                }
              : {}),
          }
        : null,
      environments: environments.map((env) => mapEnvironment(project.name, env)),
      envVars,
      recentDeploys: deployLogs.map((log) => ({
        ...log,
        commitMessage: log.commit_message ?? null,
      })),
    });
  });

  api.patch('/projects/:p/services/:s', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));

    const sourceRaw = getAliasedField(body, 'source');
    const repoUrlRaw = getAliasedField(body, 'repoUrl', 'repo_url');
    const branchRaw = getAliasedField(body, 'branch');
    const dockerfilePathRaw = getAliasedField(body, 'dockerfilePath', 'dockerfile_path');
    const dockerTargetRaw = getAliasedField(body, 'dockerTarget', 'docker_target');
    const buildContextRaw = getAliasedField(body, 'buildContext', 'build_context');
    const buildMethodRaw = getAliasedField(body, 'buildMethod', 'build_method');
    const imageUrlRaw = getAliasedField(body, 'imageUrl', 'image_url');
    const imageCmdRaw = getAliasedField(body, 'imageCmd', 'image_cmd');
    const containerPortRaw = getAliasedField(body, 'containerPort', 'container_port');
    const gitCredentialRaw = getAliasedField(body, 'gitCredentialId', 'git_credential_id');

    const source = parseNullableTextField(sourceRaw, 'source');
    const repoUrl = parseNullableTextField(repoUrlRaw, 'repoUrl');
    const branch = parseNullableTextField(branchRaw, 'branch');
    const dockerfilePath = parseNullableTextField(dockerfilePathRaw, 'dockerfilePath');
    const dockerTarget = parseNullableTextField(dockerTargetRaw, 'dockerTarget');
    const buildContext = parseNullableTextField(buildContextRaw, 'buildContext');
    const buildMethod = parseNullableTextField(buildMethodRaw, 'buildMethod');
    const imageUrl = parseNullableTextField(imageUrlRaw, 'imageUrl');
    const imageCmd = parseImageCommandField(imageCmdRaw);

    const invalidText = [
      source,
      repoUrl,
      branch,
      dockerfilePath,
      dockerTarget,
      buildContext,
      buildMethod,
      imageUrl,
    ].find((parsed): parsed is { ok: false; field: string } => !parsed.ok);
    if (invalidText) {
      return c.json(
        { error: 'INVALID_FIELD', message: `${invalidText.field} must be a string or null` },
        400,
      );
    }
    if (!imageCmd.ok) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'imageCmd must be a string, string array, or null' },
        400,
      );
    }

    const sourceValue = source.ok ? source.value : undefined;
    const repoUrlValue = repoUrl.ok ? repoUrl.value : undefined;
    const branchValue = branch.ok ? branch.value : undefined;
    const dockerfilePathValue = dockerfilePath.ok ? dockerfilePath.value : undefined;
    const dockerTargetValue = dockerTarget.ok ? dockerTarget.value : undefined;
    const buildContextValue = buildContext.ok ? buildContext.value : undefined;
    const buildMethodValue = buildMethod.ok ? buildMethod.value : undefined;
    const imageUrlValue = imageUrl.ok ? imageUrl.value : undefined;
    const imageCmdValue = imageCmd.value;
    const gitCredentialId =
      gitCredentialRaw === undefined || gitCredentialRaw === null
        ? gitCredentialRaw
        : typeof gitCredentialRaw === 'string' && gitCredentialRaw.trim().length > 0
          ? gitCredentialRaw.trim()
          : false;
    if (gitCredentialId === false) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'gitCredentialId must be a non-empty string or null' },
        400,
      );
    }

    const allowedSources = new Set(['git', 'image', 'compose', 'compose-child']);
    if (sourceValue !== undefined && sourceValue !== null && !allowedSources.has(sourceValue)) {
      return c.json(
        {
          error: 'INVALID_SOURCE_FIELDS',
          message: 'source must be git, image, compose, or compose-child',
        },
        400,
      );
    }

    const containerPort =
      containerPortRaw === undefined || containerPortRaw === null
        ? containerPortRaw === null
          ? null
          : undefined
        : typeof containerPortRaw === 'number' && Number.isInteger(containerPortRaw)
          ? containerPortRaw
          : typeof containerPortRaw === 'string'
            ? Number.parseInt(containerPortRaw, 10)
            : Number.NaN;
    if (containerPort !== undefined && containerPort !== null && !Number.isFinite(containerPort)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be a valid integer' },
        400,
      );
    }
    if (
      containerPort !== undefined &&
      containerPort !== null &&
      (containerPort < 1 || containerPort > 65535)
    ) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be between 1 and 65535' },
        400,
      );
    }

    const effectiveSource = sourceValue ?? service.source;
    const effectiveRepoUrl = repoUrlValue === undefined ? service.repo_url : repoUrlValue;
    let effectiveCredentialId = gitCredentialId;
    if (effectiveSource === 'image') {
      effectiveCredentialId = null;
    } else if (typeof effectiveCredentialId === 'string') {
      if (!effectiveRepoUrl) {
        return c.json(
          { error: 'INVALID_SOURCE_FIELDS', message: 'A Git credential requires repoUrl.' },
          400,
        );
      }
      await ctx.gitCredentials.validateForRepository(effectiveCredentialId, effectiveRepoUrl);
    } else if (
      effectiveCredentialId === undefined &&
      repoUrlValue !== undefined &&
      service.git_credential_id &&
      effectiveRepoUrl
    ) {
      await ctx.gitCredentials.validateForRepository(service.git_credential_id, effectiveRepoUrl);
    }

    await ctx.db.updateService(service.id, {
      source: sourceValue ?? undefined,
      repoUrl: repoUrlValue,
      branch: branchValue,
      dockerfilePath: dockerfilePathValue,
      dockerTarget: dockerTargetValue,
      buildContext: buildContextValue,
      buildMethod: buildMethodValue,
      imageUrl: imageUrlValue,
      imageCmd:
        imageCmdValue === undefined
          ? undefined
          : imageCmdValue === null
            ? null
            : JSON.stringify(imageCmdValue),
      containerPort,
      gitCredentialId: effectiveCredentialId,
    });

    const updatedService = await ctx.db.getService(service.id);
    if (!updatedService) {
      return c.json({ error: 'NOT_FOUND', message: 'Service not found after update' }, 404);
    }
    const [environments, domainMappingsByService] = await Promise.all([
      ctx.db.getEnvironmentsByProject(project.id),
      loadDomainMappingsByService(ctx, [updatedService]),
    ]);
    return c.json({
      service: mapServiceForApi(updatedService, environments, {
        domainMappings: domainMappingsByService.get(updatedService.id),
        autoRouteName: getDeployableServiceAutoRouteName(project, updatedService),
      }),
      message: 'Service source updated. Redeploy the service to apply changes.',
    });
  });

  return api;
}
