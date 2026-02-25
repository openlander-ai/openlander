import { createPublicKey, verify } from 'node:crypto';
import type { Context } from 'hono';
import type { Channel, ChannelManager, ChannelMessage } from './base.js';

const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

/**
 * SPKI DER prefix for Ed25519 public keys (OID 1.3.101.112).
 * Prepend to a raw 32-byte Ed25519 key to create valid SPKI DER.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const DISCORD_API_BASE = 'https://discord.com/api/v10';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED: 5,
} as const;

type DiscordUser = {
  id: string;
  username?: string;
};

type DiscordCommandOption = {
  name: string;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
};

type DiscordInteractionData = {
  name?: string;
  options?: DiscordCommandOption[];
  custom_id?: string;
  values?: string[];
};

type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  data?: DiscordInteractionData;
  member?: {
    user?: DiscordUser;
  };
  user?: DiscordUser;
};

/**
 * Verifies Discord interaction signatures using Ed25519.
 */
export function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string,
): boolean {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedTimestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  try {
    const rawKey = Buffer.from(publicKey, 'hex');
    const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
    const keyObject = createPublicKey({ key: spkiKey, format: 'der', type: 'spki' });

    return verify(null, Buffer.from(timestamp + body), keyObject, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * HTTP-only Discord channel implementation using interaction webhooks.
 */
export class DiscordChannel implements Channel {
  private readonly applicationId: string;
  private readonly publicKey: string;
  private readonly token: string;
  private readonly channelManager: ChannelManager;
  private connected = false;

  constructor(params: {
    applicationId: string;
    publicKey: string;
    token: string;
    channelManager: ChannelManager;
  }) {
    this.applicationId = params.applicationId;
    this.publicKey = params.publicKey;
    this.token = params.token;
    this.channelManager = params.channelManager;
  }

  start(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Sends a channel message with bot token authentication.
   */
  async sendMessage(channelId: string, text: string): Promise<void> {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: text }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to send Discord message (${String(response.status)} ${response.statusText}): ${errorBody}`,
      );
    }
  }

  /**
   * Posts a follow-up message to an interaction webhook.
   */
  async sendInteractionFollowup(interactionToken: string, text: string): Promise<void> {
    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${this.applicationId}/${interactionToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: text }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to send Discord follow-up (${String(response.status)} ${response.statusText}): ${errorBody}`,
      );
    }
  }

  /**
   * Validates interaction headers against the configured public key.
   */
  verifyIncomingSignature(signature: string, timestamp: string, rawBody: string): boolean {
    return verifyDiscordSignature(this.publicKey, signature, timestamp, rawBody);
  }

  /**
   * Routes normalized interaction payloads through the channel manager.
   */
  async handleIncomingMessage(message: ChannelMessage): Promise<void> {
    await this.channelManager.handleIncomingMessage(message);
  }
}

function getInteractionUser(interaction: DiscordInteraction): DiscordUser | undefined {
  return interaction.member?.user ?? interaction.user;
}

function formatCommandOptions(options: DiscordCommandOption[] | undefined): string {
  if (!options || options.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const option of options) {
    if (option.options && option.options.length > 0) {
      const nested = formatCommandOptions(option.options);
      if (nested) {
        parts.push(`${option.name}(${nested})`);
      }
      continue;
    }

    if (option.value === undefined) {
      parts.push(option.name);
      continue;
    }

    parts.push(`${option.name}=${String(option.value)}`);
  }

  return parts.join(' ');
}

function buildChannelMessage(
  interaction: DiscordInteraction,
  content: string,
  raw: DiscordInteraction,
): ChannelMessage {
  const user = getInteractionUser(interaction);

  return {
    channelType: 'discord',
    sender: user?.id ?? 'unknown',
    senderName: user?.username ?? 'Discord User',
    content,
    channelId: interaction.channel_id ?? interaction.id,
    timestamp: new Date(),
    raw,
  };
}

/**
 * Creates a Hono handler for Discord interaction endpoints.
 */
export function createDiscordInteractionHandler(
  channel: DiscordChannel,
): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const signature = c.req.header('X-Signature-Ed25519');
    const timestamp = c.req.header('X-Signature-Timestamp');
    const rawBody = await c.req.text();

    if (!signature || !timestamp) {
      return c.json({ error: 'Missing Discord signature headers.' }, 401);
    }

    if (!channel.verifyIncomingSignature(signature, timestamp, rawBody)) {
      return c.json({ error: 'Invalid Discord signature.' }, 401);
    }

    const interaction = JSON.parse(rawBody) as DiscordInteraction;

    if (interaction.type === InteractionType.PING) {
      return c.json({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const commandName = interaction.data?.name ?? 'unknown';
      const optionText = formatCommandOptions(interaction.data?.options);
      const content = optionText ? `/${commandName} ${optionText}` : `/${commandName}`;

      const message = buildChannelMessage(interaction, content, interaction);

      void (async (): Promise<void> => {
        try {
          await channel.handleIncomingMessage(message);
          await channel.sendInteractionFollowup(interaction.token, 'Command processed.');
        } catch (error) {
          const errorText = error instanceof Error ? error.message : 'Unknown error';
          await channel.sendInteractionFollowup(
            interaction.token,
            `Failed to process command: ${errorText}`,
          );
        }
      })();

      return c.json({ type: InteractionResponseType.DEFERRED });
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id ?? 'unknown-component';
      const selectedValues = interaction.data?.values?.join(',');
      const content = selectedValues
        ? `component:${customId} values:${selectedValues}`
        : `component:${customId}`;

      const message = buildChannelMessage(interaction, content, interaction);
      await channel.handleIncomingMessage(message);

      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE,
        data: { content: 'Interaction received.' },
      });
    }

    return c.json({ error: `Unsupported interaction type: ${String(interaction.type)}` }, 400);
  };
}
