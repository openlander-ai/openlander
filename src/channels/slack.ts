import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';

import type { Channel, ChannelManager, ChannelMessage } from './base.js';

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

interface SlackUrlVerificationPayload {
  type: 'url_verification';
  challenge: string;
}

interface SlackMessageEvent {
  type: 'message';
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackEventEnvelope {
  type: 'event_callback';
  event: SlackMessageEvent;
}

type SlackWebhookPayload = SlackUrlVerificationPayload | SlackEventEnvelope;

interface SlackChatPostMessageResponse {
  ok: boolean;
  error?: string;
}

/**
 * Verifies that an incoming Slack request was signed by Slack.
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedTimestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac('sha256', signingSecret).update(base).digest('hex');
  const expectedSignature = `v0=${digest}`;

  const provided = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

/**
 * Slack Events API channel implementation.
 */
export class SlackChannel implements Channel {
  private readonly token: string;
  private readonly signingSecret: string;
  private readonly channelManager: ChannelManager;
  private connected = false;

  constructor(params: { token: string; signingSecret: string; channelManager: ChannelManager }) {
    this.token = params.token;
    this.signingSecret = params.signingSecret;
    this.channelManager = params.channelManager;
  }

  /**
   * Marks the channel as connected.
   */
  start(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  /**
   * Marks the channel as disconnected.
   */
  stop(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  /**
   * Returns whether the channel is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Sends a message to a Slack channel using chat.postMessage.
   */
  async sendMessage(channelId: string, text: string): Promise<void> {
    const response = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, text }),
    });

    if (!response.ok) {
      throw new Error(`Slack API request failed with status ${String(response.status)}`);
    }

    const payload = (await response.json()) as SlackChatPostMessageResponse;
    if (!payload.ok) {
      throw new Error(`Slack API error: ${payload.error ?? 'unknown_error'}`);
    }
  }

  /**
   * Converts a Slack message event and forwards it to the channel manager.
   */
  async handleMessageEvent(event: SlackMessageEvent): Promise<void> {
    if (event.bot_id || event.subtype === 'bot_message') {
      return;
    }

    if (!event.text || !event.user || !event.channel) {
      return;
    }

    const msg: ChannelMessage = {
      channelType: 'slack',
      sender: event.user,
      senderName: event.user,
      content: event.text,
      channelId: event.channel,
      timestamp: event.ts ? new Date(Number(event.ts) * 1000) : new Date(),
      raw: event,
    };

    await this.channelManager.handleIncomingMessage(msg);
  }

  /**
   * Returns the configured Slack signing secret.
   */
  getSigningSecret(): string {
    return this.signingSecret;
  }
}

/**
 * Creates a Hono-compatible webhook handler for Slack Events API.
 */
export function createSlackWebhookHandler(
  channel: SlackChannel,
): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const signature = c.req.header('X-Slack-Signature') ?? c.req.header('x-slack-signature') ?? '';
    const timestamp =
      c.req.header('X-Slack-Request-Timestamp') ?? c.req.header('x-slack-request-timestamp') ?? '';
    const rawBody = await c.req.text();

    if (!verifySlackSignature(channel.getSigningSecret(), timestamp, rawBody, signature)) {
      return c.json({ error: 'invalid_signature' }, 401);
    }

    let payload: SlackWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as SlackWebhookPayload;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if ('challenge' in payload) {
      return c.json({ challenge: payload.challenge });
    }

    if ('event' in payload) {
      void channel.handleMessageEvent(payload.event).catch((error: unknown) => {
        console.error('[SlackChannel] Failed to process incoming message:', error);
      });
    }

    return c.json({ ok: true }, 200);
  };
}
