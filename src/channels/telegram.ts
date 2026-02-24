import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { Channel, ChannelManager, ChannelMessage } from './base.js';

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
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
}

interface TelegramChannelOptions {
  token: string;
  channelManager: ChannelManager;
  webhookSecret?: string;
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
  private connected = false;

  constructor(options: TelegramChannelOptions) {
    this.token = options.token;
    this.channelManager = options.channelManager;
    this.webhookSecret = options.webhookSecret;
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    await this.callTelegramApi('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'Markdown',
    });
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

  private async callTelegramApi(
    method: string,
    payload: Record<string, string | boolean>,
  ): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Telegram API request failed: ${String(response.status)} ${response.statusText}`);
    }

    const result = (await response.json()) as TelegramApiResponse;
    if (!result.ok) {
      throw new Error(`Telegram API error: ${result.description ?? 'unknown error'}`);
    }
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
    } catch {
      return c.json({ ok: true }, 200);
    }

    const message = update.message;
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
      console.error('[TelegramChannel] Failed to process incoming update:', error);
    });

    return c.json({ ok: true }, 200);
  };
}
