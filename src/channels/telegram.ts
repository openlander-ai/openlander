import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { QuestionBridge } from '../lib/question-bridge.js';
import {
  decodeQuestionComponentValue,
  type Channel,
  type ChannelComponent,
  type ChannelManager,
  type ChannelMessage,
} from './base.js';
import { createModuleLogger } from '../lib/logger.js';
import type { OpsAlert } from '../monitor/ops-types.js';

const log = createModuleLogger('telegram');
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
}

interface TelegramChannelOptions {
  token: string;
  channelManager: ChannelManager;
  webhookSecret?: string;
  questionBridge?: QuestionBridge;
}

/**
 * Compare webhook secrets with constant-time semantics.
 */
export function verifyTelegramWebhook(expectedSecret: string, headerSecret: string): boolean {
  const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
  const headerBuffer = Buffer.from(headerSecret, 'utf8');

  if (expectedBuffer.length !== headerBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, headerBuffer);
}

/**
 * Telegram channel implementation using Bot API and webhook updates.
 */
export class TelegramChannel implements Channel {
  private readonly token: string;
  private readonly channelManager: ChannelManager;
  private readonly webhookSecret?: string;
  private readonly questionBridge?: QuestionBridge;
  private connected = false;

  constructor(options: TelegramChannelOptions) {
    this.token = options.token;
    this.channelManager = options.channelManager;
    this.webhookSecret = options.webhookSecret;
    this.questionBridge = options.questionBridge;
  }

  async sendMessage(channelId: string, text: string): Promise<string> {
    const result = await this.callTelegramApi('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'Markdown',
    });

    const messageId = result.result?.message_id;
    if (!messageId) {
      throw new Error('Telegram API error: missing_message_id');
    }

    return String(messageId);
  }

  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    await this.callTelegramApi('editMessageText', {
      chat_id: channelId,
      message_id: Number(messageId),
      text,
      parse_mode: 'Markdown',
    });
  }

  async sendInteractive(
    channelId: string,
    text: string,
    components: ChannelComponent[],
  ): Promise<string> {
    const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const component of components) {
      if (component.type === 'button') {
        inlineKeyboard.push([
          {
            text: component.label.slice(0, 64),
            callback_data: component.value.slice(0, 64),
          },
        ]);
        continue;
      }

      for (const option of component.options) {
        inlineKeyboard.push([
          {
            text: option.label.slice(0, 64),
            callback_data: option.value.slice(0, 64),
          },
        ]);
      }
    }

    const result = await this.callTelegramApi('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({ inline_keyboard: inlineKeyboard }),
    });

    const messageId = result.result?.message_id;
    if (!messageId) {
      throw new Error('Telegram API error: missing_message_id');
    }

    return String(messageId);
  }

  async start(): Promise<void> {
    this.connected = true;

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }

    const payload: Record<string, string> = { url: webhookUrl };
    if (this.webhookSecret) {
      payload.secret_token = this.webhookSecret;
    }

    await this.callTelegramApi('setWebhook', payload);
  }

  async stop(): Promise<void> {
    this.connected = false;

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }

    await this.callTelegramApi('deleteWebhook', {
      drop_pending_updates: false,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getWebhookSecret(): string | undefined {
    return this.webhookSecret;
  }

  async forwardIncomingMessage(message: ChannelMessage): Promise<void> {
    await this.channelManager.handleIncomingMessage(message);
  }

  async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const rawValue = query.data ?? '';
    const decoded = decodeQuestionComponentValue(rawValue);
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (decoded && this.questionBridge) {
      this.questionBridge.reply(decoded.requestId, [
        {
          questionIndex: decoded.questionIndex,
          selectedLabels: [decoded.value],
        },
      ]);

      if (chatId !== undefined && messageId !== undefined) {
        await this.editMessage(String(chatId), String(messageId), `✅ Selected: ${decoded.value}`);
      }
    }

    await this.callTelegramApi('answerCallbackQuery', {
      callback_query_id: query.id,
    });
  }

  /**
   * Formats an OpsAlert for Telegram with MarkdownV2 escaping.
   */
  formatOpsAlert(alert: OpsAlert): { text: string; extra?: unknown } {
    const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
    const escape = (s: string) => s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    const lines = [
      `${icon} *\\[${alert.severity.toUpperCase()}\\]* ${escape(alert.project.name)}: ${escape(alert.title)}`,
      escape(alert.description),
    ];
    if (alert.suggestion) lines.push(`_${escape(alert.suggestion)}_`);
    return { text: lines.join('\n') };
  }

  private async callTelegramApi(
    method: string,
    payload: Record<string, string | number | boolean>,
  ): Promise<TelegramApiResponse> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Telegram API request failed: ${String(response.status)} ${response.statusText}`,
      );
    }

    const result = (await response.json()) as TelegramApiResponse;
    if (!result.ok) {
      throw new Error(`Telegram API error: ${result.description ?? 'unknown error'}`);
    }

    return result;
  }
}

/**
 * Create a Hono webhook handler for Telegram updates.
 */
export function createTelegramWebhookHandler(
  channel: TelegramChannel,
): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const expectedSecret = channel.getWebhookSecret();
    if (expectedSecret) {
      const headerSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
      if (!headerSecret || !verifyTelegramWebhook(expectedSecret, headerSecret)) {
        return c.json({ ok: false }, 401);
      }
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json<TelegramUpdate>();
    } catch (err) {
      log.debug({ err }, 'Failed to parse Telegram update JSON — returning ok');
      return c.json({ ok: true }, 200);
      return c.json({ ok: true }, 200);
    }

    const message = update.message;
    if (update.callback_query) {
      void channel.handleCallbackQuery(update.callback_query).catch((error: unknown) => {
        log.error({ error }, 'Failed to process Telegram callback query');
      });
      return c.json({ ok: true }, 200);
    }

    if (!message?.text) {
      return c.json({ ok: true }, 200);
    }

    const incoming: ChannelMessage = {
      channelType: 'telegram',
      sender: String(message.from?.id ?? 'unknown'),
      senderName: message.from?.username ?? message.from?.first_name ?? 'Unknown',
      content: message.text,
      channelId: String(message.chat.id),
      timestamp: new Date(message.date * 1000),
      raw: update,
    };

    void channel.forwardIncomingMessage(incoming).catch((error: unknown) => {
      log.error({ error }, 'Failed to process incoming update');
    });

    return c.json({ ok: true }, 200);
  };
}
