import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadServiceViewRecords } from '../../db/views/service-view.js';
import { ProjectNotFoundError } from '../../errors.js';
import {
  findService,
  resolveDeployableServiceForRoute,
  resolveProject,
} from './helpers/deployable-service-route-shared.js';
import {
  getAliasedField,
  mapEnvironment,
  mapProjectForApi,
  mapServiceForApi,
  parseImageCommandField,
  parseNullableTextField,
} from './helpers/project-route-shared.js';

export function createDeployableServiceRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/services', async (c) => {
    const projectParam = c.req.param('id');
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      const err = new ProjectNotFoundError(projectParam);
      return c.json(err.toJSON(), err.statusCode as 404);
    }

    const [deployables, environments] = await Promise.all([
      ctx.db.getDeployablesByGroup(project.id),
      ctx.db.getEnvironmentsByProject(project.id),
    ]);

    return c.json({
      count: deployables.length,
      services: deployables.map((service) => mapServiceForApi(service, environments)),
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
    const [environments, deployLogs, serviceRecords] = await Promise.all([
      ctx.db.getEnvironmentsByProject(project.id),
      ctx.db.getDeployLogs(project.id, 5),
      loadServiceViewRecords(ctx.db, [project]),
    ]);

    return c.json({
      ...mapProjectForApi(project, serviceRecords.get(project.id)?.service ?? undefined),
      service: service ? mapServiceForApi(service, environments) : null,
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
    });

    const updatedService = await ctx.db.getService(service.id);
    if (!updatedService) {
      return c.json({ error: 'NOT_FOUND', message: 'Service not found after update' }, 404);
    }
    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    return c.json({
      service: mapServiceForApi(updatedService, environments),
      message: 'Service source updated. Redeploy the service to apply changes.',
    });
  });

  return api;
}
