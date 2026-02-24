import type { AppContext } from '../app.js';
import { type EventBus, eventBus } from '../events/index.js';

export type ChannelType = 'slack' | 'discord' | 'telegram';

/**
 * Base channel contract implemented by all chat platforms.
 */
export interface Channel {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelId: string, text: string): Promise<void>;
  isConnected(): boolean;
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
        console.error(`[ChannelManager] Failed to start ${type} channel:`, error);
      }
    }
  }

  /** Stop all registered channels with fault isolation. */
  async stop(): Promise<void> {
    for (const [type, channel] of this.channels.entries()) {
      try {
        await channel.stop();
      } catch (error) {
        console.error(`[ChannelManager] Failed to stop ${type} channel:`, error);
      }
    }
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
      console.error(`[ChannelManager] No registered channel for type: ${msg.channelType}`);
      return;
    }

    if (!this.ctx.agent) {
      console.warn(
        `[ChannelManager] Agent is not configured; message ignored for ${msg.channelType}`,
      );
      return;
    }

    const sessionId = `${msg.channelType}-${msg.channelId}-${msg.sender}`;

    try {
      const response = await this.ctx.agent.chat(msg.content, sessionId);
      if (!response.message.trim()) {
        return;
      }

      await channel.sendMessage(msg.channelId, response.message);
    } catch (error) {
      console.error(
        `[ChannelManager] Failed to process message from ${msg.channelType}:${msg.channelId}`,
        error,
      );
    }
  }
}
