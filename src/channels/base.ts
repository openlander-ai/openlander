import type { AppContext } from '../app.js';
import { type EventBus, eventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ChatStreamEvent } from '../agent/index.js';
import type { QuestionRequest } from '../agent/question-bridge.js';

const log = createModuleLogger('channels');
export type ChannelType = 'slack' | 'discord' | 'telegram';

export type ChannelComponent =
  | {
      type: 'button';
      label: string;
      value: string;
      style?: 'primary' | 'secondary' | 'danger';
    }
  | {
      type: 'select';
      placeholder: string;
      options: { label: string; value: string; description?: string }[];
    };

type DecodedQuestionComponent = {
  requestId: string;
  questionIndex: number;
  value: string;
};

const EDIT_THROTTLE_MS = 1500;
const QUESTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Base channel contract implemented by all chat platforms.
 */
export interface Channel {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelId: string, text: string): Promise<string>;
  editMessage(channelId: string, messageId: string, text: string): Promise<void>;
  sendInteractive?(
    channelId: string,
    text: string,
    components: ChannelComponent[],
  ): Promise<string>;
  isConnected(): boolean;
}

export function encodeQuestionComponentValue(
  requestId: string,
  questionIndex: number,
  value: string,
): string {
  const encodedValue = Buffer.from(value, 'utf8').toString('base64url');
  return `olq:${requestId}:${String(questionIndex)}:${encodedValue}`;
}

export function decodeQuestionComponentValue(raw: string): DecodedQuestionComponent | null {
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'olq') {
    return null;
  }

  const parsedIndex = Number(parts[2]);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    return null;
  }

  try {
    return {
      requestId: parts[1] ?? '',
      questionIndex: parsedIndex,
      value: Buffer.from(parts[3] ?? '', 'base64url').toString('utf8'),
    };
  } catch {
    return null;
  }
}

function buildQuestionPromptText(request: QuestionRequest): string {
  const question = request.questions[0];
  if (!question) {
    return 'Agent needs input.';
  }

  const header = question.header?.trim();
  if (header) {
    return `❓ ${header}\n${question.question}`;
  }

  return `❓ ${question.question}`;
}

function buildQuestionComponents(request: QuestionRequest): ChannelComponent[] {
  const question = request.questions[0];
  if (!question || question.options.length === 0) {
    return [];
  }

  if (question.multiple || question.options.length > 3) {
    return [
      {
        type: 'select',
        placeholder: question.question,
        options: question.options.map((option) => ({
          label: option.label,
          value: encodeQuestionComponentValue(request.id, 0, option.label),
          description: option.description,
        })),
      },
    ];
  }

  return question.options.map((option, index) => ({
    type: 'button',
    label: option.label,
    value: encodeQuestionComponentValue(request.id, 0, option.label),
    style: index === 0 ? 'primary' : 'secondary',
  }));
}

function buildQuestionFallbackText(request: QuestionRequest): string {
  const question = request.questions[0];
  if (!question) {
    return 'Agent needs input.';
  }

  const options = question.options.map((option) => `- ${option.label}`).join('\n');
  return `${buildQuestionPromptText(request)}\n${options}`;
}

/**
 * Normalized incoming message shape across all channels.
 */
export interface ChannelMessage {
  channelType: ChannelType;
  sender: string;
  senderName: string;
  content: string;
  channelId: string;
  timestamp: Date;
  raw?: unknown;
}

/**
 * Central channel lifecycle and routing coordinator.
 */
export class ChannelManager {
  private readonly channels = new Map<ChannelType, Channel>();
  private readonly ctx: AppContext;
  private readonly events: EventBus;

  constructor(ctx: AppContext, events: EventBus = eventBus) {
    this.ctx = ctx;
    this.events = events;
  }

  private getBroadcastChannelId(type: ChannelType): string | null {
    const configuredId =
      type === 'slack'
        ? this.ctx.config.channels.slack.recoveryChannelId
        : type === 'discord'
          ? this.ctx.config.channels.discord.recoveryChannelId
          : this.ctx.config.channels.telegram.recoveryChannelId;

    if (!configuredId) {
      return null;
    }

    const trimmed = configuredId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /** Register a channel implementation for a platform type. */
  register(type: ChannelType, channel: Channel): void {
    this.channels.set(type, channel);
  }

  /** Start all registered channels with fault isolation. */
  async start(): Promise<void> {
    for (const [type, channel] of this.channels.entries()) {
      try {
        await channel.start();

        if (channel.isConnected()) {
          await this.events.emit('channel:connect', { channelType: type });
        }
      } catch (error) {
        log.error({ error, channelType: type }, 'Failed to start channel');
      }
    }
  }

  /** Stop all registered channels with fault isolation. */
  async stop(): Promise<void> {
    for (const [type, channel] of this.channels.entries()) {
      try {
        await channel.stop();
      } catch (error) {
        log.error({ error, channelType: type }, 'Failed to stop channel');
      }
    }
  }

  async broadcast(text: string): Promise<void> {
    for (const [type, channel] of this.channels.entries()) {
      if (!channel.isConnected()) {
        continue;
      }

      const channelId = this.getBroadcastChannelId(type);
      if (!channelId) {
        continue;
      }

      try {
        await channel.sendMessage(channelId, text);
      } catch (error) {
        log.error({ error, channelType: type }, 'Failed to broadcast to channel');
      }
    }
  }

  async sendRecoveryNotification(message: string): Promise<void> {
    await this.broadcast(message);
  }

  /** Get a channel by type if it is registered. */
  getChannel(type: ChannelType): Channel | undefined {
    return this.channels.get(type);
  }

  /** List currently connected channel types. */
  listConnected(): ChannelType[] {
    const connected: ChannelType[] = [];

    for (const [type, channel] of this.channels.entries()) {
      if (channel.isConnected()) {
        connected.push(type);
      }
    }

    return connected;
  }

  /**
   * Process an incoming message, emit events, call the agent,
   * and send the response back to the originating channel.
   */
  async handleIncomingMessage(msg: ChannelMessage): Promise<void> {
    await this.events.emit('channel:message', {
      channelType: msg.channelType,
      content: msg.content,
      sender: msg.sender,
    });

    const channel = this.channels.get(msg.channelType);
    if (!channel) {
      log.error({ channelType: msg.channelType }, 'No registered channel for type');
      return;
    }

    if (!this.ctx.agent) {
      log.warn({ channelType: msg.channelType }, 'Agent is not configured; message ignored');
      return;
    }

    const sessionId = `${msg.channelType}-${msg.channelId}-${msg.sender}`;
    let statusMessageId: string | null = null;
    let lastEditAt = 0;
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    const sendFallbackMessage = async (text: string): Promise<void> => {
      try {
        const newMessageId = await channel.sendMessage(msg.channelId, text);
        if (newMessageId) {
          statusMessageId = newMessageId;
          lastEditAt = Date.now();
        }
      } catch (error) {
        log.error(
          { error, channelType: msg.channelType, channelId: msg.channelId },
          'Failed to send channel message',
        );
      }
    };

    const updateStatus = async (text: string, force = false): Promise<void> => {
      if (!force && Date.now() - lastEditAt < EDIT_THROTTLE_MS) {
        return;
      }

      if (statusMessageId) {
        try {
          await channel.editMessage(msg.channelId, statusMessageId, text);
          lastEditAt = Date.now();
          return;
        } catch (error) {
          log.warn(
            { error, channelType: msg.channelType, channelId: msg.channelId },
            'Failed to edit status message; sending fallback message',
          );
        }
      }

      await sendFallbackMessage(text);
    };

    const handleQuestion = async (request: QuestionRequest): Promise<void> => {
      const questionText = buildQuestionPromptText(request);
      const components = buildQuestionComponents(request);

      if (channel.sendInteractive && components.length > 0) {
        try {
          await channel.sendInteractive(msg.channelId, questionText, components);
        } catch (error) {
          log.warn(
            { error, channelType: msg.channelType, channelId: msg.channelId },
            'Failed to send interactive question; using text fallback',
          );
          await sendFallbackMessage(buildQuestionFallbackText(request));
        }
      } else {
        await sendFallbackMessage(buildQuestionFallbackText(request));
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        if (this.ctx.questionBridge.hasPending()) {
          this.ctx.questionBridge.reject();
        }
      }, QUESTION_TIMEOUT_MS);
    };

    const onStreamEvent = async (event: ChatStreamEvent): Promise<void> => {
      switch (event.type) {
        case 'thinking': {
          await updateStatus('🤔 Thinking...');
          return;
        }
        case 'tool_call': {
          await updateStatus(`🔧 Running ${event.toolName}...`);
          return;
        }
        case 'tool_result': {
          const resultText = event.success
            ? `✅ ${event.toolName} complete`
            : `❌ ${event.toolName} failed${event.error ? `: ${event.error}` : ''}`;
          await updateStatus(resultText);
          return;
        }
        case 'message': {
          const content = event.content.trim();
          if (content) {
            await updateStatus(content, true);
          }

          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          return;
        }
        case 'question': {
          await updateStatus('❓ Waiting for your input...', true);
          await handleQuestion(event.request);
          return;
        }
        case 'error': {
          await updateStatus(`❌ Error: ${event.error}`, true);
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          return;
        }
        default:
          return;
      }
    };

    try {
      statusMessageId = await channel.sendMessage(msg.channelId, '🤔 Thinking...');
      lastEditAt = Date.now();

      await this.ctx.agent.chatStream(msg.content, onStreamEvent, sessionId);
    } catch (error) {
      log.error(
        { error, channelType: msg.channelType, channelId: msg.channelId },
        'Failed to process message',
      );
    } finally {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    }
  }
}
