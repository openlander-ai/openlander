import type { AppContext } from '../../src/app.js';
import { composeToolDefs } from '../../src/tools/defs/compose.js';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { webhookToolDefs } from '../../src/tools/defs/webhook.js';
import { environmentToolDefs } from '../../src/tools/defs/environment.js';
import type { ToolDef, ToolTarget } from '../../src/tools/defs/types.js';

export interface LegacyToolSpec {
  name: string;
  description: string;
  inputSchema: ToolDef['inputSchema'];
  execute: (
    args: Record<string, unknown>,
    context: {
      target: ToolTarget;
    },
  ) => Promise<any> | any;
  targets?: ToolDef['targets'];
}

const sharedToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...debugToolDefs,
  ...serviceToolDefs,
  ...composeToolDefs,
  ...webhookToolDefs,
  ...environmentToolDefs,
];

export function createSharedToolRegistry(
  appCtx: AppContext,
  options?: {
    target?: ToolTarget;
    names?: readonly string[];
  },
): LegacyToolSpec[] {
  const names = options?.names ? new Set(options.names) : null;

  return sharedToolDefs
    .filter((def) => (names ? names.has(def.name) : true))
    .filter((def) => {
      if (!options?.target) {
        return true;
      }
      return !def.targets || def.targets.includes(options.target);
    })
    .map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      targets: def.targets,
      execute: (args, context) =>
        def.execute(args, {
          target: context.target,
          appCtx,
        }),
    }));
}
