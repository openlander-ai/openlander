import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { QuestionBridge } from '../agent/question-bridge.js';

import {
  decodeQuestionComponentValue,
  type Channel,
  type ChannelComponent,
  type ChannelManager,
  type ChannelMessage,
} from './base.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('slack');
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_UPDATE_API_URL = 'https://slack.com/api/chat.update';
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

interface SlackInteractionPayload {
  type: 'block_actions';
  user?: { id?: string; username?: string; name?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  actions?: Array<{
    value?: string;
    selected_option?: { value?: string };
  }>;
}

type SlackWebhookPayload = SlackUrlVerificationPayload | SlackEventEnvelope;

interface SlackChatPostMessageResponse {
  ok: boolean;
  ts?: string;
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
  private readonly questionBridge?: QuestionBridge;
  private connected = false;

  constructor(params: {
    token: string;
    signingSecret: string;
    channelManager: ChannelManager;
    questionBridge?: QuestionBridge;
  }) {
    this.token = params.token;
    this.signingSecret = params.signingSecret;
    this.channelManager = params.channelManager;
    this.questionBridge = params.questionBridge;
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
  async sendMessage(channelId: string, text: string): Promise<string> {
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

    if (!payload.ts) {
      throw new Error('Slack API error: missing_message_id');
    }

    return payload.ts;
  }

  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    const response = await fetch(SLACK_UPDATE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, ts: messageId, text }),
    });

    if (!response.ok) {
      throw new Error(`Slack API request failed with status ${String(response.status)}`);
    }

    const payload = (await response.json()) as SlackChatPostMessageResponse;
    if (!payload.ok) {
      throw new Error(`Slack API error: ${payload.error ?? 'unknown_error'}`);
    }
  }

  async sendInteractive(
    channelId: string,
    text: string,
    components: ChannelComponent[],
  ): Promise<string> {
    const elements: Array<Record<string, unknown>> = [];

    for (const component of components) {
      if (component.type === 'button') {
        elements.push({
          type: 'button',
          text: { type: 'plain_text', text: component.label },
          value: component.value,
          action_id: `ol_btn_${component.value.slice(0, 32)}`,
          style:
            component.style === 'primary' || component.style === 'danger'
              ? component.style
              : undefined,
        });
        continue;
      }

      elements.push({
        type: 'static_select',
        placeholder: { type: 'plain_text', text: component.placeholder.slice(0, 150) },
        action_id: 'ol_select',
        options: component.options.map((option) => ({
          text: { type: 'plain_text', text: option.label.slice(0, 75) },
          value: option.value,
          description: option.description
            ? { type: 'plain_text', text: option.description.slice(0, 75) }
            : undefined,
        })),
      });
    }

    const response = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          { type: 'actions', elements },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack API request failed with status ${String(response.status)}`);
    }

    const payload = (await response.json()) as SlackChatPostMessageResponse;
    if (!payload.ok || !payload.ts) {
      throw new Error(`Slack API error: ${payload.error ?? 'unknown_error'}`);
    }

    return payload.ts;
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

  async handleInteractionPayload(payload: SlackInteractionPayload): Promise<void> {
    const selectedRawValue =
      payload.actions?.[0]?.selected_option?.value ?? payload.actions?.[0]?.value ?? '';
    const decoded = decodeQuestionComponentValue(selectedRawValue);
    const channelId = payload.channel?.id;
    const messageId = payload.message?.ts;

    if (decoded && this.questionBridge) {
      this.questionBridge.reply(decoded.requestId, [
        {
          questionIndex: decoded.questionIndex,
          selectedLabels: [decoded.value],
        },
      ]);

      if (channelId && messageId) {
        await this.editMessage(channelId, messageId, `✅ Selected: ${decoded.value}`);
      }
    }
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

    const contentType = c.req.header('Content-Type') ?? c.req.header('content-type') ?? '';

    if (
      contentType.includes('application/x-www-form-urlencoded') ||
      rawBody.startsWith('payload=')
    ) {
      const form = new URLSearchParams(rawBody);
      const interactionRaw = form.get('payload');
      if (!interactionRaw) {
        return c.json({ error: 'invalid_interaction_payload' }, 400);
      }

      try {
        const interaction = JSON.parse(interactionRaw) as SlackInteractionPayload;
        await channel.handleInteractionPayload(interaction);
        return c.json({ ok: true }, 200);
      } catch (err) {
        log.debug({ err }, 'Failed to parse Slack interaction payload JSON');
        return c.json({ error: 'invalid_json' }, 400);
      }
    }

    let payload: SlackWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as SlackWebhookPayload;
    } catch (err) {
      log.debug({ err }, 'Failed to parse Slack webhook payload JSON');
      return c.json({ error: 'invalid_json' }, 400);
    }

    if ('challenge' in payload) {
      return c.json({ challenge: payload.challenge });
    }

    if ('event' in payload) {
      void channel.handleMessageEvent(payload.event).catch((error: unknown) => {
        log.error({ error }, 'Failed to process incoming message');
      });
    }

    return c.json({ ok: true }, 200);
  };
}
