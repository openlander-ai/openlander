import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { deriveGroupStatusFromServices } from '../../db/repos/project.repo.js';
import { loadServiceViewRecords } from '../../db/views/service-view.js';
import {
  DeployLockedError,
  OpenLanderError,
  ProjectAlreadyExistsError,
  ProjectHasActiveServicesError,
  ProjectSlugImmutableError,
  ProjectSourceRemovedError,
} from '../../errors.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import {
  assertProjectHasNoActiveServices,
  assertProjectLifecycleMutableForRoute,
  createProjectGroupWithSlugRetry,
  deriveProjectSlug,
  deriveGroupLifecycleState,
  lifecycleErrorResponse,
  mapEnvironment,
  mapProjectForApi,
  normalizeNullableText,
  normalizeProjectTagsInput,
  parseProjectTags,
  PROJECT_NAME_REGEX,
  type ProjectPatchBody,
  withProjectRuntimeLock,
} from './helpers/project-route-shared.js';

export function createProjectGroupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/projects', async (c) => {
    const body = await c.req
      .json<{
        repo_url?: string;
        branch?: string;
        name?: unknown;
        displayName?: unknown;
        display_name?: unknown;
        description?: unknown;
        tags?: unknown;
      }>()
      .catch(() => ({
        repo_url: undefined,
        branch: undefined,
        name: undefined,
        displayName: undefined,
        display_name: undefined,
        description: undefined,
        tags: undefined,
      }));
    const repoUrl = body.repo_url?.trim() || undefined;
    const explicitName = typeof body.name === 'string' ? body.name.trim() : undefined;
    const displayNameRaw = body.displayName ?? body.display_name;
    const displayName =
      typeof displayNameRaw === 'string' && displayNameRaw.trim().length > 0
        ? displayNameRaw.trim()
        : undefined;

    if (repoUrl || body.branch !== undefined) {
      return c.json(new ProjectSourceRemovedError().toJSON(), 400);
    }
    if (!explicitName && !displayName) {
      return c.json(
        {
          error: 'MISSING_FIELD',
          code: 'MISSING_FIELD',
          message: 'name or displayName is required',
        },
        400,
      );
    }
    if (explicitName && !PROJECT_NAME_REGEX.test(explicitName)) {
      return c.json(
        {
          error: 'INVALID_PROJECT_NAME',
          message:
            'Project name must start with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens',
        },
        400,
      );
    }

    let description: string | null | undefined;
    let tags: string | null | undefined;
    try {
      description = normalizeNullableText(body.description, 'description');
      tags = normalizeProjectTagsInput(body.tags);
    } catch (err) {
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      throw err;
    }

    const slug = explicitName ?? deriveProjectSlug(displayName ?? 'project');
    const created = await createProjectGroupWithSlugRetry(ctx, {
      slug,
      displayName: displayName ?? slug,
      description,
      tags,
      allowSuffix: explicitName === undefined,
    }).catch((err: unknown) => {
      if (err instanceof ProjectAlreadyExistsError) return err;
      throw err;
    });

    if (created instanceof ProjectAlreadyExistsError) {
      const existing = await ctx.db.getProjectByName(slug);
      return c.json({ ...created.toJSON(), projectId: existing?.id }, 409);
    }

    return c.json({
      project: {
        id: created.id,
        name: created.name,
        displayName: created.display_name || created.name,
        description: created.description,
        tags: parseProjectTags(created.tags),
        status: created.status ?? 'idle',
      },
    });
  });

  api.get('/projects', async (c) => {
    const status = c.req.query('status') as
      'running' | 'stopped' | 'building' | 'error' | undefined;
    const includeArchived = c.req.query('include_archived') === 'true';
    const projectsWithMeta = await ctx.db.listProjectsWithMetadata(status, { includeArchived });
    const serviceRecords = await loadServiceViewRecords(
      ctx.db,
      projectsWithMeta.map(({ project }) => project),
    );

    return c.json({
      count: projectsWithMeta.length,
      projects: projectsWithMeta.map(
        ({
          project: p,
          environments,
          childCount,
          activeChildCount,
          deployableChildCount,
          isCompose,
          partiallyArchived,
          failedInitialDeploy,
        }) => {
          const mapped = mapProjectForApi(p, serviceRecords.get(p.id)?.service ?? undefined);
          return {
            id: mapped.id,
            name: mapped.name,
            displayName: mapped.displayName,
            display_name: mapped.display_name,
            description: mapped.description,
            tags: mapped.tags,
            // `p.status` is pre-hydrated by listProjectsWithMetadata from
            // the whole deployable group. Keep list cards aligned with
            // topology health instead of showing only the canonical service.
            status: p.status ?? mapped.status,
            visibility: mapped.visibility,
            source: mapped.source,
            archived_at: partiallyArchived ? null : mapped.archived_at,
            port: mapped.port,
            url: mapped.url,
            urls: mapped.urls,
            publicUrl: mapped.publicUrl,
            ...(mapped.imageUrl ? { imageUrl: mapped.imageUrl } : {}),
            createdAt: mapped.created_at,
            updatedAt: mapped.updated_at,
            parentProjectId: mapped.parent_project_id,
            partiallyArchived,
            partially_archived: partiallyArchived,
            isCompose,
            failedInitialDeploy,
            failed_initial_deploy: failedInitialDeploy,
            activeServiceCount: activeChildCount,
            active_service_count: activeChildCount,
            serviceCount: childCount,
            deployableServiceCount: deployableChildCount,
            totalServiceCount: childCount,
            environments: environments.map((env) => mapEnvironment(mapped.name, env)),
          };
        },
      ),
    });
  });

  api.get('/projects/:id', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const [envVars, environments, deployLogs, serviceRecords, deployables, groupServices] =
      await Promise.all([
        ctx.env.getAll(project.id),
        ctx.db.getEnvironmentsByProject(project.id),
        ctx.db.getDeployLogs(project.id, 5),
        loadServiceViewRecords(ctx.db, [project]),
        ctx.db.getDeployablesByGroup(project.id),
        ctx.db.getServices({ project_id: project.id }),
      ]);
    const lifecycle = deriveGroupLifecycleState(deployables);
    const mapped = mapProjectForApi(project, serviceRecords.get(project.id)?.service ?? undefined);
    const status = deriveGroupStatusFromServices(groupServices) ?? mapped.status;

    return c.json({
      ...mapped,
      status,
      archived_at: lifecycle.partiallyArchived ? null : mapped.archived_at,
      partiallyArchived: lifecycle.partiallyArchived,
      partially_archived: lifecycle.partiallyArchived,
      environments: environments.map((env) => mapEnvironment(project.name, env)),
      envVars,
      recentDeploys: deployLogs.map((log) => ({
        ...log,
        commitMessage: log.commit_message ?? null,
      })),
    });
  });

  api.patch('/projects/:id', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const body = await c.req.json<ProjectPatchBody>().catch((): ProjectPatchBody => ({}));

    if (body.name !== undefined) {
      const err = new ProjectSlugImmutableError(project.name);
      return c.json(err.toJSON(), 400);
    }

    let displayName: string | undefined;
    let description: string | null | undefined;
    let tags: string | null | undefined;
    try {
      const displayNameInput = body.displayName ?? body.display_name;
      const normalizedDisplayName = normalizeNullableText(displayNameInput, 'displayName');
      if (displayNameInput !== undefined) {
        if (normalizedDisplayName === null) {
          return c.json(
            {
              error: 'INVALID_FIELD',
              code: 'INVALID_FIELD',
              message: 'displayName must not be empty',
              details: { field: 'displayName' },
            },
            400,
          );
        }
        displayName = normalizedDisplayName;
      }
      description = normalizeNullableText(body.description, 'description');
      tags = normalizeProjectTagsInput(body.tags);
    } catch (err) {
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      throw err;
    }

    const imageUrlRaw = body.imageUrl ?? body.image_url;
    const imageCmdRaw = body.imageCmd ?? body.image_cmd;
    const containerPortRaw = body.containerPort ?? body.container_port;
    const imageUrl =
      imageUrlRaw === undefined || imageUrlRaw === null
        ? undefined
        : typeof imageUrlRaw === 'string'
          ? imageUrlRaw
          : undefined;
    const imageCmd =
      imageCmdRaw === undefined || imageCmdRaw === null
        ? undefined
        : Array.isArray(imageCmdRaw) && imageCmdRaw.every((entry) => typeof entry === 'string')
          ? imageCmdRaw
          : typeof imageCmdRaw === 'string'
            ? imageCmdRaw
                .split(' ')
                .map((part) => part.trim())
                .filter((part) => part.length > 0)
            : undefined;
    const containerPort =
      containerPortRaw === undefined || containerPortRaw === null
        ? undefined
        : typeof containerPortRaw === 'number' && Number.isInteger(containerPortRaw)
          ? containerPortRaw
          : typeof containerPortRaw === 'string'
            ? Number.parseInt(containerPortRaw, 10)
            : undefined;

    if (containerPort !== undefined && !Number.isFinite(containerPort)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be a valid integer' },
        400,
      );
    }
    if (containerPort !== undefined && (containerPort < 1 || containerPort > 65535)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be between 1 and 65535' },
        400,
      );
    }

    await ctx.db.updateProject(project.id, {
      displayName,
      description,
      tags,
      imageUrl,
      imageCmd: imageCmdRaw === undefined ? undefined : imageCmd ? JSON.stringify(imageCmd) : null,
      containerPort,
    });

    const updatedProject = await ctx.db.getProject(project.id);
    if (!updatedProject) {
      return c.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
    }
    const serviceRecords = await loadServiceViewRecords(ctx.db, [updatedProject]);
    return c.json(
      mapProjectForApi(updatedProject, serviceRecords.get(updatedProject.id)?.service ?? undefined),
    );
  });

  api.post('/projects/:id/archive', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const deployables = await ctx.db.getDeployablesByGroup(project.id);
    const lifecycle = deriveGroupLifecycleState(deployables);
    const policyProject = lifecycle.partiallyArchived ? { ...project, archived_at: null } : project;

    try {
      await assertProjectLifecycleMutableForRoute(policyProject, 'archive', ctx);
    } catch (err) {
      const response = lifecycleErrorResponse(err);
      if (response) return c.json(response.body, response.status);
      throw err;
    }

    const result = await withProjectRuntimeLock(ctx, project.id, 'archive', async () => {
      ctx.coordinator.suppressProject(project.id, 60_000);
      await ctx.pipeline.archiveGroup(project.id);
      return ctx.db.getProject(project.id);
    });
    if (result instanceof DeployLockedError) return c.json(result.toJSON(), 409);
    return c.json({ project: result });
  });

  api.post('/projects/:id/unarchive', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    await ctx.pipeline.unarchiveGroup(project.id);
    const updated = await ctx.db.getProject(project.id);
    return c.json({ project: updated });
  });

  api.delete('/projects/:id/purge', async (c) => {
    const confirm = c.req.query('confirm');
    if (confirm !== 'true') {
      return c.json(
        { error: 'Confirmation required. Add ?confirm=true to permanently delete.' },
        400,
      );
    }
    return handleProjectHardDelete(ctx, c.req.param('id'), 'purge');
  });

  api.delete('/projects/:id', async (c) => {
    return handleProjectHardDelete(ctx, c.req.param('id'), 'delete');
  });

  return api;
}

async function handleProjectHardDelete(
  ctx: AppContext,
  projectId: string,
  action: 'delete' | 'purge',
) {
  const project = await ctx.db.getProject(projectId);
  if (!project) {
    throw new OpenLanderError('Project not found', 'PROJECT_NOT_FOUND', 404);
  }

  try {
    await assertProjectLifecycleMutableForRoute(project, 'purge', ctx);
  } catch (err) {
    const response = lifecycleErrorResponse(err);
    if (response)
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
    throw err;
  }
  try {
    await assertProjectHasNoActiveServices(ctx, project);
  } catch (err) {
    if (err instanceof ProjectHasActiveServicesError) {
      return new Response(JSON.stringify(err.toJSON()), {
        status: 409,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
    }
    throw err;
  }

  const result = await withProjectRuntimeLock(ctx, project.id, action, async () => {
    ctx.coordinator.suppressProject(project.id, 60_000);
    await ctx.pipeline.remove(project.id, ctx.cloudflare);
    return { success: true, message: 'Project permanently deleted' };
  });
  if (result instanceof DeployLockedError) {
    return new Response(JSON.stringify(result.toJSON()), {
      status: 409,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}
