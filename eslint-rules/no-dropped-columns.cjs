/**
 * Custom ESLint rule: no-dropped-columns
 *
 * Flags reads of columns dropped in migration 0012 from `ProjectRow` /
 * `ServiceRow` shapes — e.g. `project.status`, `project.assigned_port`,
 * `service.type`, etc. These properties remain on the row TYPE as
 * `@deprecated` optionals (see `src/db/types.ts`) so existing fallback
 * chains still compile through 1.0; the eslint rule prevents new readers
 * from being introduced.
 *
 * Plan §"PR 5 ESLint rule" + §AC: "ESLint rule `no-dropped-columns` active
 * and green on the merged feature branch."
 *
 * Detection: matches MemberExpression nodes whose property name is in the
 * dropped-columns list AND whose object is a known project/service-shaped
 * identifier or property access (project.X, service.X, projectRow.X, svc.X,
 * etc.). Whitelist via the directive `// eslint-disable-line no-dropped-columns`
 * for the handful of remaining transitional fallback chains the plan
 * preserves through 1.0 (wire-format builders that emit `port: assigned_port`).
 *
 * Excluded scope (rule does NOT fire):
 *   - test/** — tests can still seed/inspect the legacy shape.
 *   - drizzle/** SQL migrations.
 *   - src/db/types.ts — the type definition file itself.
 *   - tools/db/migration-phase-logger.ts and dry-run-migration.ts.
 *   - src/db/repos/*.ts — repos translate between old/new vocabulary.
 */

'use strict';

const PROJECT_DROPPED_COLUMNS = new Set([
  'parent_project_id',
  'parentProjectId',
  'status',
  'visibility',
  'assigned_port',
  'container_id',
  'container_port',
  'image_tag',
  'previous_image_tag',
  'public_url',
  'dockerfile_path',
  'docker_target',
  'build_context',
  'build_method',
  'image_url',
  'image_cmd',
  'pending_fix',
  'access_code',
  'access_code_iv',
  'is_preview',
  'pr_number',
  'project_type',
  'health_check_strategy',
  'health_check_path',
  'recovering_started_at',
]);

const SERVICE_DROPPED_COLUMNS = new Set(['type', 'image', 'port', 'env_vars']);

const PROJECT_OBJECT_NAME_HINT = /^(project|projectRow|p|pj|pr|grp|group|projectInfo|targetProject)$/;
const SERVICE_OBJECT_NAME_HINT =
  /^(service|svc|serviceRow|s|servicedRow|targetService|childService|managedService)$/;

function isProjectLike(node) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    return PROJECT_OBJECT_NAME_HINT.test(node.name);
  }
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
    return PROJECT_OBJECT_NAME_HINT.test(node.property.name);
  }
  return false;
}

function isServiceLike(node) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    return SERVICE_OBJECT_NAME_HINT.test(node.name);
  }
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
    return SERVICE_OBJECT_NAME_HINT.test(node.property.name);
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reads of columns dropped in migration 0012 from ProjectRow / ServiceRow shapes',
      recommended: false,
    },
    schema: [],
    messages: {
      droppedProjectCol:
        'Reading dropped column "{{prop}}" from a project row. ' +
        'Migration 0012 removed projects.{{prop}}; read services.* via ' +
        'getDeployableForProject(projectId) instead.',
      droppedServiceCol:
        'Reading dropped column "{{prop}}" from a service row. ' +
        'Migration 0012 removed services.{{prop}}; read the canonical column ' +
        '(kind/image_url/assigned_port) instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (
      filename.includes('/test/') ||
      filename.includes('\\test\\') ||
      filename.includes('/drizzle/') ||
      filename.endsWith('/src/db/types.ts') ||
      filename.endsWith('/src/db/types.js') ||
      filename.includes('/src/db/repos/') ||
      filename.endsWith('migration-phase-logger.ts') ||
      filename.endsWith('dry-run-migration.ts')
    ) {
      return {};
    }
    return {
      MemberExpression(node) {
        if (node.property.type !== 'Identifier') return;

        // Exempt: MemberExpression is either side of a `??` operator.
        // Pattern: `canonical?.X ?? legacy.X` — legitimate canonical-first/
        // legacy-fallback wire compatibility chains introduced in PR 4.5.
        // Both LHS and RHS of `??` are exempt because the dropped column may
        // appear on either side of a transitional fallback chain.
        const parent = node.parent;
        if (
          parent &&
          parent.type === 'LogicalExpression' &&
          parent.operator === '??'
        ) {
          return;
        }

        const propName = node.property.name;
        if (PROJECT_DROPPED_COLUMNS.has(propName) && isProjectLike(node.object)) {
          context.report({
            node,
            messageId: 'droppedProjectCol',
            data: { prop: propName },
          });
          return;
        }
        if (SERVICE_DROPPED_COLUMNS.has(propName) && isServiceLike(node.object)) {
          context.report({
            node,
            messageId: 'droppedServiceCol',
            data: { prop: propName },
          });
        }
      },
    };
  },
};
