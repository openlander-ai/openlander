import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { BuildStreamEvent } from '../../web/src/lib/event-types.js';
import type { ChatStreamEvent } from '../../web/src/types/index.js';
import { toTimelineItem } from '../../web/src/lib/event-types.js';
import {
  buildEventToAssistantItem,
  chatEventToAssistantItem,
} from '../../web/src/hooks/assistant-event-mapper.js';
import { TimelineItemCard } from '../../web/src/components/timeline/TimelineItem.js';
import { FixProposalCard } from '../../web/src/components/timeline/FixProposalCard.js';
import { ComposeErrorCard } from '../../web/src/components/timeline/ComposeErrorCard.js';
import { createTools } from '../../src/agent/tools.js';
import type { AppContext } from '../../src/app.js';
import type { QuestionBridge } from '../../src/agent/question-bridge.js';
import { Database } from '../../src/db/index.js';
import { matchRecipe } from '../../src/agent/recipes.js';
import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { cloneRepo } from '../../src/pipeline/git.js';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/lib/time', () => ({
  formatTime: (ts: string) => ts,
}));

vi.mock('lucide-react', () => ({
  Bot: () => 'Bot',
  ChevronDown: () => 'ChevronDown',
  ChevronUp: () => 'ChevronUp',
  CheckCircle2: () => 'CheckCircle2',
  XCircle: () => 'XCircle',
  Rocket: () => 'Rocket',
  Search: () => 'Search',
  Wrench: () => 'Wrench',
  Key: () => 'Key',
  MessageCircle: () => 'MessageCircle',
  Clock: () => 'Clock',
  LayoutList: () => 'LayoutList',
  ScrollText: () => 'ScrollText',
  Activity: () => 'Activity',
  KeyRound: () => 'KeyRound',
  ExternalLink: () => 'ExternalLink',
  RotateCcw: () => 'RotateCcw',
  Layers: () => 'Layers',
  Menu: () => 'Menu',
  Cpu: () => 'Cpu',
  MemoryStick: () => 'MemoryStick',
  Bell: () => 'Bell',
  HardDrive: () => 'HardDrive',
  AlertTriangle: () => 'AlertTriangle',
  AlertCircle: () => 'AlertCircle',
  Info: () => 'Info',
  X: () => 'X',
  ArrowRight: () => 'ArrowRight',
  Archive: () => 'Archive',
  Container: () => 'Container',
  Network: () => 'Network',
  Server: () => 'Server',
  Play: () => 'Play',
  Square: () => 'Square',
  RefreshCw: () => 'RefreshCw',
  Trash2: () => 'Trash2',
  Globe: () => 'Globe',
  Globe2: () => 'Globe2',
  Loader2: () => 'Loader2',
  Terminal: () => 'Terminal',
  Settings: () => 'Settings',
  LogOut: () => 'LogOut',
  ChevronRight: () => 'ChevronRight',
  ChevronLeft: () => 'ChevronLeft',
  Plus: () => 'Plus',
  MoreVertical: () => 'MoreVertical',
  MoreHorizontal: () => 'MoreHorizontal',
  Edit: () => 'Edit',
  Copy: () => 'Copy',
  Check: () => 'Check',
  FileCode2: () => 'FileCode2',
  Send: () => 'Send',
  SkipForward: () => 'SkipForward',
  MessageCircleQuestion: () => 'MessageCircleQuestion',
}));

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => getTextContent(child)).join('');
  }

  if (node && typeof node === 'object') {
    const element = node as {
      type?: unknown;
      props?: { children?: unknown };
    };

    if (typeof element.type === 'function') {
      return getTextContent(element.type(element.props));
    }

    if (element.props?.children) {
      return getTextContent(element.props.children);
    }
  }

  return '';
}

function createToolsContext(db: Database, questionBridge: QuestionBridge) {
  const startDeploy = vi
    .fn()
    .mockResolvedValue({ projectId: 'p1', projectName: 'demo', status: 'building' });

  const ctx = {
    config: { git: { sshKeyPath: '' } },
    db,
    pipeline: { startDeploy },
    composePipeline: { detectComposeFile: vi.fn(), deployCompose: vi.fn() },
    buildDebugger: { fixDockerfile: vi.fn() },
    alertMonitor: { getActiveAlerts: vi.fn(), dismissAlert: vi.fn() },
    env: {
      setBulk: vi.fn(),
      setGlobalSecret: vi.fn(),
      getGlobalSecretsMasked: vi.fn().mockReturnValue([]),
    },
    cloudflare: {},
    docker: {},
    blueGreen: { deploy: vi.fn() },
    dbProvisioner: { provision: vi.fn() },
    previewDeployer: { deploy: vi.fn(), cleanup: vi.fn(), list: vi.fn().mockReturnValue([]) },
    serviceManager: { listServices: vi.fn(), ensureService: vi.fn(), getServiceLogs: vi.fn() },
    webhookManager: {},
    traefik: {},
    deployQueue: {},
    healthMonitor: {},
    channelManager: {},
    autoDetector: {},
    questionBridge,
    mcpClientManager: {},
    agent: null,
    jobManager: {},
  } as unknown as AppContext;

  const tools = createTools(ctx, questionBridge) as unknown as Record<
    string,
    {
      execute?: (input: Record<string, unknown>, options?: unknown) => Promise<unknown>;
    }
  >;

  return { tools, startDeploy };
}

describe('agent UX integration flow', () => {
  it('covers compose failure -> recipe/debug path -> structured timeline + chat tool-result rendering', () => {
    const buildFailureLog = "env_file './backend/.env' not found";
    const recipe = matchRecipe(buildFailureLog);
    expect(recipe?.title).toBe('Docker Compose env_file missing');

    const flowEvents: BuildStreamEvent[] = [
      {
        type: 'agent_tool_result',
        message: 'deploy_compose failed',
        projectId: 'p1',
        timestamp: '2026-03-15T00:00:01.000Z',
        toolName: 'deploy_compose',
        toolSuccess: false,
        toolError: buildFailureLog,
        toolResult: { error: 'BUILD_FAILED', message: buildFailureLog },
      },
      {
        type: 'agent_tool_result',
        message: 'Analyzed compose failure',
        projectId: 'p1',
        timestamp: '2026-03-15T00:00:02.000Z',
        toolName: 'debug_build_error',
        toolSuccess: true,
        toolResult: {
          summary: 'Missing env_file in compose config',
          rootCause: 'docker-compose.yml references ./backend/.env but file is absent',
          suggestedFixes: [
            {
              description: 'Use root-level .env and selective injection',
              confidence: 'high',
            },
          ],
        },
      },
    ];

    const timelineItems = flowEvents.map((event) => toTimelineItem(event));
    const deployFailure = timelineItems[0];
    const analysis = timelineItems[1];

    expect(deployFailure.toolName).toBe('deploy_compose');
    expect(deployFailure.toolSuccess).toBe(false);
    expect(analysis.toolName).toBe('debug_build_error');

    const rendered = TimelineItemCard({ item: analysis });
    const content = getTextContent(rendered);

    expect(content).toContain('timeline.errorAnalysis.title');
    expect(content).toContain('Missing env_file in compose config');
    expect(content).toContain('docker-compose.yml references ./backend/.env but file is absent');
    expect(content).not.toContain('View result ▾');

    const assistantFromBuild = buildEventToAssistantItem(flowEvents[1]);
    expect(assistantFromBuild?.type).toBe('tool_result');
    expect(assistantFromBuild?.toolName).toBe('debug_build_error');
    expect(assistantFromBuild?.toolResult).toEqual(flowEvents[1].toolResult);

    const chatToolResultEvent: ChatStreamEvent = {
      type: 'tool_result',
      toolName: 'debug_build_error',
      success: true,
      result: flowEvents[1].toolResult,
    };
    const assistantFromChat = chatEventToAssistantItem(chatToolResultEvent);
    expect(assistantFromChat?.type).toBe('tool_result');
    expect(assistantFromChat?.toolName).toBe('debug_build_error');
    expect(assistantFromChat?.toolResult).toEqual(flowEvents[1].toolResult);
  });

  it('routes question metadata to compose and fix-proposal timeline renderers', () => {
    const composeQuestion = toTimelineItem({
      type: 'question_pending',
      message: 'Choose compose env strategy',
      projectId: 'p1',
      timestamp: '2026-03-15T00:00:03.000Z',
      questionId: 'q-compose',
      questions: [
        {
          question: 'How should we fix env_file?',
          options: [{ label: 'Root .env' }, { label: 'Per-service env files' }],
          metadata: {
            fixType: 'compose',
            errorType: 'env_file_missing',
            patterns: [
              {
                id: 'root-env',
                name: 'Root .env',
                description: 'Use one root-level env file',
                codeSnippet: 'env_file: .env',
                recommended: true,
              },
            ],
          },
        },
      ],
    });

    const fixProposalQuestion = toTimelineItem({
      type: 'question_pending',
      message: 'Apply this compose fix?',
      projectId: 'p1',
      timestamp: '2026-03-15T00:00:04.000Z',
      questionId: 'q-fix',
      questions: [
        {
          question: 'Approve compose update and redeploy?',
          options: [{ label: 'Apply this fix' }, { label: 'Show me other options' }],
          metadata: {
            fixType: 'dockerfile',
            filePath: 'docker-compose.yml',
            before: 'env_file: ./backend/.env',
            after: 'env_file: ./.env',
            changes: ['Updated env_file path to project root'],
          },
        },
      ],
    });

    const composeRendered = TimelineItemCard({ item: composeQuestion });
    const fixRendered = TimelineItemCard({ item: fixProposalQuestion });

    expect(composeRendered.type).toBe(ComposeErrorCard);
    expect(fixRendered.type).toBe(FixProposalCard);
  });

  it('proves assistant chat-event path keeps structured tool and question context', () => {
    const toolCallEvent: ChatStreamEvent = {
      type: 'tool_call',
      toolName: 'debug_build_error',
      arguments: { projectId: 'p1' },
    };

    const toolResultEvent: ChatStreamEvent = {
      type: 'tool_result',
      toolName: 'debug_build_error',
      success: true,
      result: {
        summary: 'Missing env_file in compose config',
        rootCause: 'env_file path points to a missing file',
        suggestedFixes: [{ description: 'Use root .env', confidence: 'high' }],
      },
    };

    const questionEvent: ChatStreamEvent = {
      type: 'question',
      request: {
        id: 'q-chat-fix',
        questions: [
          {
            question: 'Apply proposed compose fix?',
            options: [{ label: 'Apply this fix' }, { label: 'Show me other options' }],
          },
        ],
      },
    };

    const questionWithMetadata = questionEvent.request.questions[0] as Record<string, unknown>;
    questionWithMetadata.metadata = {
      fixType: 'dockerfile',
      filePath: 'docker-compose.yml',
      before: 'env_file: ./backend/.env',
      after: 'env_file: ./.env',
    };

    const mappedCall = chatEventToAssistantItem(toolCallEvent);
    const mappedResult = chatEventToAssistantItem(toolResultEvent);
    const mappedQuestion = chatEventToAssistantItem(questionEvent);

    expect(mappedCall?.type).toBe('tool_call');
    expect(mappedResult?.type).toBe('tool_result');
    expect(mappedResult?.toolName).toBe('debug_build_error');
    expect(mappedResult?.toolResult).toEqual(toolResultEvent.result);
    expect(mappedQuestion?.questionData?.metadata).toEqual({
      fixType: 'dockerfile',
      filePath: 'docker-compose.yml',
      before: 'env_file: ./backend/.env',
      after: 'env_file: ./.env',
    });

    expect(mappedCall?.toolName).toBe('debug_build_error');
    expect(mappedResult?.toolSuccess).toBe(true);
  });

  it('covers approval metadata -> pending fix durability -> pipeline clone-time application', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'openlander-agent-ux-int-'));
    const db = new Database(join(tmpDir, 'test.db'));

    try {
      db.createProject({
        id: 'p1',
        name: 'demo',
        repoUrl: 'https://github.com/openlander/demo',
        branch: 'main',
      });

      const bridge = {
        ask: vi
          .fn()
          .mockResolvedValue([
            { questionIndex: 0, selectedLabels: ['Apply this fix and redeploy'], customText: '' },
          ]),
      } as unknown as QuestionBridge;

      const { tools, startDeploy } = createToolsContext(db, bridge);
      const askUserQuestion = tools.ask_user_question;
      expect(askUserQuestion?.execute).toBeDefined();

      const fixQuestionMetadata = {
        fixType: 'dockerfile',
        projectId: 'p1',
        filePath: 'docker-compose.yml',
        before: 'env_file: ./backend/.env',
        after: 'env_file: ./.env',
        changes: ['Updated env_file path to project root'],
      };

      const timelineQuestion = toTimelineItem({
        type: 'question_pending',
        message: 'Apply this compose fix?',
        projectId: 'p1',
        timestamp: '2026-03-15T00:00:04.000Z',
        questionId: 'q-fix-deploy',
        questions: [
          {
            question: 'Approve compose update and redeploy?',
            options: [{ label: 'Apply this fix and redeploy' }, { label: 'Show me other options' }],
            metadata: fixQuestionMetadata,
          },
        ],
      });

      const timelineRendered = TimelineItemCard({ item: timelineQuestion });
      expect(timelineRendered.type).toBe(FixProposalCard);

      const chatQuestionEvent: ChatStreamEvent = {
        type: 'question',
        request: {
          id: 'q-chat-fix-deploy',
          questions: [
            {
              question: 'Approve compose update and redeploy?',
              options: [
                { label: 'Apply this fix and redeploy' },
                { label: 'Show me other options' },
              ],
              metadata: fixQuestionMetadata,
            },
          ],
        },
      };
      const mappedChatQuestion = chatEventToAssistantItem(chatQuestionEvent);
      expect(mappedChatQuestion?.questionData?.metadata).toEqual(fixQuestionMetadata);

      const result = await askUserQuestion!.execute!(
        {
          questions: JSON.stringify([
            {
              question: 'Approve compose update and redeploy?',
              options: [{ label: 'Apply this fix and redeploy' }],
              metadata: fixQuestionMetadata,
            },
          ]),
        },
        {},
      );

      expect(result).toEqual(expect.objectContaining({ appliedFix: true, fixType: 'dockerfile' }));
      expect(startDeploy).toHaveBeenCalledOnce();

      const persisted = db.getProject('p1')?.pending_fix;
      expect(persisted).toBeTruthy();
      const parsedPendingFix = JSON.parse(persisted ?? '{}') as {
        filePath?: string;
        content?: string;
      };
      expect(parsedPendingFix.filePath).toBe('docker-compose.yml');
      expect(parsedPendingFix.content).toBe('env_file: ./.env');

      const clonedRepoPath = join(tmpDir, 'repo-clone');
      const composePath = join(clonedRepoPath, 'docker-compose.yml');
      (cloneRepo as any).mockResolvedValue({ path: clonedRepoPath, commitSha: 'cafefeed' });

      const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
      mkdirSync(clonedRepoPath, { recursive: true });
      writeFileSync(composePath, 'env_file: ./backend/.env\n', 'utf8');

      const composePipeline = {
        detectComposeFile: vi.fn().mockReturnValue(composePath),
        deployCompose: vi.fn().mockResolvedValue({
          success: true,
          parentProjectId: 'p1',
          parentName: 'demo',
          services: [],
          buildDurationMs: 42,
        }),
      };

      const envManager = {
        getAll: vi.fn().mockReturnValue({}),
        getMergedForDeploy: vi.fn().mockReturnValue({}),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      };

      const deployPipeline = new DeployPipeline(
        {} as never,
        db,
        envManager as never,
        undefined,
        composePipeline as never,
      );

      const productionEnvironment = db
        .getEnvironmentsByProject('p1')
        .find((environment) => environment.type === 'production');
      expect(productionEnvironment).toBeDefined();

      const deployResult = await deployPipeline.deployEnvironment('p1', productionEnvironment!.id, {
        repoUrl: 'https://github.com/openlander/demo',
        trigger: 'chat',
      });

      expect(deployResult.success).toBe(true);
      expect(composePipeline.deployCompose).toHaveBeenCalledOnce();
      expect(readFileSync(composePath, 'utf8')).toBe('env_file: ./.env');
      expect(db.getProject('p1')?.pending_fix).toBeNull();
      expect(cloneRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/openlander/demo',
          branch: 'main',
        }),
      );
    } finally {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
