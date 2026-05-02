import { nanoid } from 'nanoid';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { QuestionBridge } from '../../lib/question-bridge.js';
import { getActiveQuestionHandler } from '../../lib/question-bridge.js';
import { createModuleLogger } from '../../lib/logger.js';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
} from '../../errors.js';
import type { ToolDef } from '../defs/types.js';

const log = createModuleLogger('ai-sdk-adapter');

/**
 * Acquire the per-project agent-pool lock for fire-and-forget deploy/redeploy
 * tool calls so chat-driven flows do not bypass the BUG-002 regression guard
 * the way they did before 1.0 GA.
 *
 * Returns a `release` callback (idempotent no-op on failure) and `acquired`
 * so callers can short-circuit with a typed `DEPLOY_LOCKED` response when
 * another session is already mutating the project.
 */
function acquireAgentPoolLock(
  appCtx: AppContext,
  projectId: string,
  prefix: 'agent-deploy' | 'agent-fix',
): { acquired: boolean; sessionId: string; release: () => void; lockedBy?: string } {
  const sessionId = `${prefix}-${nanoid(8)}`;
  if (!appCtx.agentPool) {
    return { acquired: true, sessionId, release: () => undefined };
  }
  const acquired = appCtx.agentPool.acquireProjectLock(projectId, sessionId);
  if (!acquired) {
    const lock = appCtx.agentPool.getProjectLock(projectId);
    return {
      acquired: false,
      sessionId,
      release: () => undefined,
      lockedBy: lock?.sessionId,
    };
  }
  let released = false;
  return {
    acquired: true,
    sessionId,
    release: () => {
      if (released) return;
      released = true;
      appCtx.agentPool?.releaseProjectLock(projectId, sessionId);
    },
  };
}

const MAX_FIX_ATTEMPTS = 3;

interface PendingFixPayload {
  filePath: string;
  content: string;
}

interface FixAttemptState {
  failureId: string;
  count: number;
}

export function toAiSdkTools(
  defs: ToolDef[],
  appCtx: AppContext,
  questionBridge?: QuestionBridge,
): ToolSet {
  const fixAttempts = new Map<string, FixAttemptState>();

  const trackFixAttempt = (projectId: string, failureId: string) => {
    const previous = fixAttempts.get(projectId);
    const nextCount = previous && previous.failureId === failureId ? previous.count + 1 : 1;
    fixAttempts.set(projectId, { failureId, count: nextCount });
    return { count: nextCount, exceeded: nextCount > MAX_FIX_ATTEMPTS };
  };

  const savePendingFix = async (projectId: string, pendingFix: PendingFixPayload) => {
    await appCtx.db.setPendingFix(projectId, pendingFix);
  };

  const shouldApplyApprovedFix = (selectedLabels: string[]) => {
    return selectedLabels.some((label) => /\b(apply|approve)\b/i.test(label));
  };

  const parsePendingFixMetadata = (metadata: Record<string, unknown> | undefined) => {
    if (!metadata) {
      return null;
    }

    const filePath = metadata['filePath'];
    const after = metadata['after'];
    if (typeof filePath !== 'string' || typeof after !== 'string') {
      return null;
    }

    return {
      filePath,
      content: after,
    } satisfies PendingFixPayload;
  };

  const tools: ToolSet = {};

  for (const def of defs) {
    if (def.targets && !def.targets.includes('agent')) {
      continue;
    }

    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: (args) => {
        return def.execute(args, { target: 'agent', appCtx });
      },
    });
  }

  tools['fix_dockerfile'] = tool({
    description:
      'Analyze a failed build and generate a fixed Dockerfile using AI. Use when a build fails due to Dockerfile content errors (wrong Node version, missing dependencies, invalid syntax). Returns { dockerfileContent, explanation, changes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
    inputSchema: z.object({
      project_name: z.string().describe('Name of project with Dockerfile build error'),
    }),
    execute: async ({ project_name }) => {
      if (!appCtx.buildDebugger) {
        return {
          error: 'Build debugger requires an LLM provider. Configure one first.',
        };
      }

      const project = await appCtx.db.getProjectByName(project_name);
      if (!project) {
        throw new ProjectNotFoundError(project_name);
      }

      const lastDeploy = await appCtx.db.getLastDeployLog(project.id);
      if (!lastDeploy || lastDeploy.status !== 'failed') {
        return { error: 'No failed build found for this project.' };
      }

      const attempt = trackFixAttempt(project.id, lastDeploy.id);
      if (attempt.exceeded) {
        return {
          error: 'MAX_FIX_ATTEMPTS_REACHED',
          message:
            'Reached the maximum of 3 fix attempts for this failure. Please update the repository manually before retrying.',
        };
      }

      const { cloneRepo } = await import('../../pipeline/git.js');
      const { readDockerfile } = await import('../../pipeline/build-debugger.js');
      const cloneResult = await cloneRepo({
        repoUrl: project.repo_url ?? '',
        branch: project.branch,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
      });
      const currentDockerfile = readDockerfile(cloneResult.path) ?? 'Not available';

      const fixResult = await appCtx.buildDebugger.fixDockerfile({
        projectPath: cloneResult.path,
        currentDockerfile,
        buildError: lastDeploy.build_log ?? 'No build log available',
        projectName: project_name,
      });

      if (!questionBridge) {
        return {
          status: 'proposal_ready',
          attempts: attempt.count,
          ...fixResult,
        };
      }

      const request = {
        id: lastDeploy.id,
        questions: [
          {
            question: 'I generated a Dockerfile fix. Should I apply this fix and redeploy now?',
            header: 'Dockerfile Fix',
            options: [
              {
                label: 'Apply this fix and redeploy',
                description: 'Store this Dockerfile fix and trigger a redeploy immediately.',
              },
              {
                label: 'Show me other options',
                description: 'Do not apply this fix yet. I will suggest alternatives.',
              },
            ],
            metadata: {
              fixType: 'dockerfile',
              projectId: project.id,
              projectName: project.name,
              failureId: lastDeploy.id,
              filePath: 'Dockerfile',
              before: currentDockerfile,
              after: fixResult.dockerfileContent,
              changes: fixResult.changes,
              attempt: attempt.count,
              maxAttempts: MAX_FIX_ATTEMPTS,
            },
          },
        ],
      };

      const inlineHandler = getActiveQuestionHandler();
      const answers = await questionBridge.ask(
        request,
        inlineHandler ? { handler: inlineHandler } : undefined,
      );
      if (answers.length === 0) {
        return {
          status: 'dismissed',
          message: 'Fix proposal was dismissed. Dockerfile was not changed.',
          attempts: attempt.count,
          ...fixResult,
        };
      }

      const selection = answers[0];
      const selectedLabels = selection?.selectedLabels ?? [];
      if (!shouldApplyApprovedFix(selectedLabels)) {
        return {
          status: 'rejected',
          message: 'Fix proposal was not approved. Dockerfile remains unchanged.',
          attempts: attempt.count,
          selectedLabels,
          ...fixResult,
        };
      }

      if (!project.repo_url) {
        return {
          error: 'MISSING_REPO_URL',
          message: 'Project has no repository URL configured.',
        };
      }

      await savePendingFix(project.id, {
        filePath: 'Dockerfile',
        content: fixResult.dockerfileContent,
      });

      // 1.0 GA: per-project lock so a chat-driven Dockerfile fix does not
      // bypass the BUG-002 regression guard (concurrent deploy on the same
      // project from another session).
      const lock = acquireAgentPoolLock(appCtx, project.id, 'agent-fix');
      if (!lock.acquired) {
        return {
          status: 'rejected',
          error: 'DEPLOY_LOCKED',
          message: `Project is busy (held by ${lock.lockedBy ?? 'another session'}). Try again shortly.`,
          attempts: attempt.count,
          ...fixResult,
        };
      }
      try {
        const deploy = await appCtx.pipeline.startDeploy({
          repoUrl: project.repo_url,
          branch: project.branch,
          name: project.name,
          trigger: 'chat',
        });

        return {
          status: 'approved',
          attempts: attempt.count,
          deploy,
          ...fixResult,
        };
      } catch (err) {
        if (
          err instanceof DeployLockedError ||
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          log.warn(
            { err, projectId: project.id, code: err.code },
            'Dockerfile fix deploy rejected by policy / lock',
          );
          return {
            status: 'rejected',
            error: err.code,
            message: err.message,
            attempts: attempt.count,
            ...fixResult,
          };
        }
        throw err;
      } finally {
        lock.release();
      }
    },
  });

  if (questionBridge) {
    tools['ask_user_question'] = tool({
      description:
        "Ask the user a question with structured choices during a conversation. Use when you need to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer options. Each question has a header (max 30 chars), a question string, and an array of options with label (1-5 words) and description. A 'Type your own answer' option is automatically added. If you recommend a specific option, list it first and add '(Recommended)' to its label. Set multiple=true to allow multi-select. Returns an array of answers, each with selectedLabels (array of chosen label strings) and optional customText.",
      inputSchema: z.object({
        questions: z
          .string()
          .describe(
            'JSON array of question objects. Each: { question: string, header?: string (max 30 chars), options: [{ label: string (1-5 words), description?: string }], multiple?: boolean, metadata?: Record<string, unknown> }',
          ),
      }),
      execute: async ({ questions }) => {
        const questionsParsed = JSON.parse(questions) as Array<{
          question: string;
          header?: string;
          options: Array<{ label: string; description?: string }>;
          multiple?: boolean;
          metadata?: Record<string, unknown>;
        }>;

        const request = {
          id: nanoid(12),
          questions: questionsParsed.map((item) => ({
            question: item.question,
            header: item.header?.slice(0, 30),
            options: item.options.map((option) => ({
              label: option.label.slice(0, 30),
              description: option.description,
            })),
            multiple: item.multiple ?? false,
            metadata: item.metadata,
          })),
        };

        // Resolve the per-stream UI handler from AsyncLocalStorage so two
        // concurrent agent streams each get their own callback, instead of
        // last-write-wins through `setQuestionHandler`.
        const inlineHandler = getActiveQuestionHandler();
        const askOptions = inlineHandler ? { handler: inlineHandler } : undefined;
        const answers = await questionBridge.ask(request, askOptions);
        if (answers.length === 0) {
          return {
            dismissed: true,
            message: 'User dismissed the question without answering.',
          };
        }

        const firstQuestion = request.questions[0];
        const firstAnswer = answers[0];
        const pendingFix = parsePendingFixMetadata(firstQuestion?.metadata);
        const fixType = firstQuestion?.metadata?.['fixType'];
        const metadataProjectId = firstQuestion?.metadata?.['projectId'];
        const metadataProjectName = firstQuestion?.metadata?.['projectName'];

        const targetProject =
          typeof metadataProjectId === 'string'
            ? await appCtx.db.getProject(metadataProjectId)
            : typeof metadataProjectName === 'string'
              ? await appCtx.db.getProjectByName(metadataProjectName)
              : undefined;

        if (
          pendingFix &&
          targetProject &&
          shouldApplyApprovedFix(firstAnswer?.selectedLabels ?? [])
        ) {
          const failureIdRaw = firstQuestion?.metadata?.['failureId'];
          const failureId =
            typeof failureIdRaw === 'string' && failureIdRaw.trim().length > 0
              ? failureIdRaw
              : `session:${targetProject.id}`;
          const attempt = trackFixAttempt(targetProject.id, failureId);
          if (attempt.exceeded) {
            return {
              message:
                'Reached the maximum of 3 fix attempts for this failure. Please apply a manual fix.',
              maxAttemptsReached: true,
              fixType,
            };
          }

          if (!targetProject.repo_url) {
            return {
              error: 'MISSING_REPO_URL',
              message: 'Project has no repository URL configured.',
            };
          }

          await savePendingFix(targetProject.id, pendingFix);

          // 1.0 GA: per-project lock so applying a fix from chat does not
          // bypass the BUG-002 regression guard.
          const lock = acquireAgentPoolLock(appCtx, targetProject.id, 'agent-deploy');
          if (!lock.acquired) {
            return {
              answers: answers.map((answer) => ({
                questionIndex: answer.questionIndex,
                selectedLabels: answer.selectedLabels,
                customText: answer.customText,
              })),
              appliedFix: false,
              fixType,
              error: 'DEPLOY_LOCKED',
              message: `Project is busy (held by ${lock.lockedBy ?? 'another session'}). Try again shortly.`,
            };
          }
          try {
            const deploy = await appCtx.pipeline.startDeploy({
              repoUrl: targetProject.repo_url,
              branch: targetProject.branch,
              name: targetProject.name,
              trigger: 'chat',
            });

            return {
              answers: answers.map((answer) => ({
                questionIndex: answer.questionIndex,
                selectedLabels: answer.selectedLabels,
                customText: answer.customText,
              })),
              appliedFix: true,
              fixType,
              deploy,
            };
          } catch (err) {
            if (
              err instanceof DeployLockedError ||
              err instanceof ProjectArchivedError ||
              err instanceof ProjectRecoveringError ||
              err instanceof CircuitBreakerOpenError
            ) {
              log.warn(
                { err, projectId: targetProject.id, code: err.code },
                'Apply-fix deploy rejected by policy / lock',
              );
              return {
                answers: answers.map((answer) => ({
                  questionIndex: answer.questionIndex,
                  selectedLabels: answer.selectedLabels,
                  customText: answer.customText,
                })),
                appliedFix: false,
                fixType,
                error: err.code,
                message: err.message,
              };
            }
            throw err;
          } finally {
            lock.release();
          }
        }

        return {
          answers: answers.map((answer) => ({
            questionIndex: answer.questionIndex,
            selectedLabels: answer.selectedLabels,
            customText: answer.customText,
          })),
        };
      },
    });
  }

  return tools;
}
