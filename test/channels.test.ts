import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

import { ChannelManager, type Channel, type ChannelMessage } from '../src/channels/base.js';
import { SlackChannel, verifySlackSignature } from '../src/channels/slack.js';
import { DiscordChannel, verifyDiscordSignature } from '../src/channels/discord.js';
import { TelegramChannel, verifyTelegramWebhook } from '../src/channels/telegram.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Mock AppContext for ChannelManager
// ---------------------------------------------------------------------------

function createMockAppContext() {
  return {
    config: {},
    agent: {
      chat: vi.fn().mockResolvedValue({ message: 'AI response' }),
    },
    db: {},
    docker: {},
    pipeline: {},
    env: {},
    channelManager: {} as unknown,
    healthMonitor: {},
  } as unknown as Parameters<typeof ChannelManager>[0];
}

function createMockEventBus() {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Base Channel tests
// ---------------------------------------------------------------------------

describe('Channel interface', () => {
  it('defines required methods: start, stop, sendMessage, isConnected', () => {
    const channel: Channel = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };

    expect(typeof channel.start).toBe('function');
    expect(typeof channel.stop).toBe('function');
    expect(typeof channel.sendMessage).toBe('function');
    expect(typeof channel.isConnected).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// ChannelManager tests
// ---------------------------------------------------------------------------

describe('ChannelManager', () => {
  let manager: ChannelManager;
  let mockChannel: Channel;
  let mockCtx: Parameters<typeof ChannelManager>[0];

  beforeEach(() => {
    mockCtx = createMockAppContext();
    manager = new ChannelManager(
      mockCtx,
      createMockEventBus() as unknown as Parameters<typeof ChannelManager>[1],
    );
    mockChannel = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };
  });

  it('registers channels with register()', () => {
    manager.register('slack', mockChannel);
    expect(manager.getChannel('slack')).toBe(mockChannel);
  });

  it('returns undefined for unregistered channel type', () => {
    expect(manager.getChannel('slack')).toBeUndefined();
  });

  it('starts all registered channels', async () => {
    manager.register('slack', mockChannel);
    manager.register('discord', mockChannel);

    await manager.start();

    expect(mockChannel.start).toHaveBeenCalledTimes(2);
  });

  it('stops all registered channels', async () => {
    manager.register('slack', mockChannel);
    manager.register('discord', mockChannel);

    await manager.stop();

    expect(mockChannel.stop).toHaveBeenCalledTimes(2);
  });

  it('listConnected() returns only connected channels', async () => {
    const connectedChannel: Channel = {
      ...mockChannel,
      isConnected: vi.fn().mockReturnValue(true),
    };
    const disconnectedChannel: Channel = {
      ...mockChannel,
      isConnected: vi.fn().mockReturnValue(false),
    };

    manager.register('slack', connectedChannel);
    manager.register('discord', disconnectedChannel);

    const connected = manager.listConnected();
    expect(connected).toContain('slack');
    expect(connected).not.toContain('discord');
  });

  it('handleIncomingMessage sends response to channel', async () => {
    manager.register('slack', mockChannel);

    const msg: ChannelMessage = {
      channelType: 'slack',
      sender: 'U12345',
      senderName: 'Test User',
      content: 'Hello',
      channelId: 'C12345',
      timestamp: new Date(),
    };

    await manager.handleIncomingMessage(msg);

    expect(mockCtx.agent?.chat).toHaveBeenCalled();
    expect(mockChannel.sendMessage).toHaveBeenCalledWith('C12345', 'AI response');
  });

  it('handleIncomingMessage does nothing if channel not registered', async () => {
    const msg: ChannelMessage = {
      channelType: 'slack',
      sender: 'U12345',
      senderName: 'Test User',
      content: 'Hello',
      channelId: 'C12345',
      timestamp: new Date(),
    };

    // Should not throw
    await manager.handleIncomingMessage(msg);
    expect(mockCtx.agent?.chat).not.toHaveBeenCalled();
  });

  it('handleIncomingMessage does nothing if agent not configured', async () => {
    const ctxNoAgent = { ...mockCtx, agent: null };
    manager = new ChannelManager(
      ctxNoAgent,
      createMockEventBus() as unknown as Parameters<typeof ChannelManager>[1],
    );
    manager.register('slack', mockChannel);

    const msg: ChannelMessage = {
      channelType: 'slack',
      sender: 'U12345',
      senderName: 'Test User',
      content: 'Hello',
      channelId: 'C12345',
      timestamp: new Date(),
    };

    await manager.handleIncomingMessage(msg);
    expect(mockChannel.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SlackChannel tests
// ---------------------------------------------------------------------------

describe('SlackChannel', () => {
  let channel: SlackChannel;
  let mockChannelManager: ChannelManager;

  beforeEach(() => {
    mockChannelManager = {
      handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelManager;

    channel = new SlackChannel({
      token: 'xoxb-test-token',
      signingSecret: 'test-secret',
      channelManager: mockChannelManager,
    });
  });

  it('start() marks channel as connected', async () => {
    expect(channel.isConnected()).toBe(false);
    await channel.start();
    expect(channel.isConnected()).toBe(true);
  });

  it('stop() marks channel as disconnected', async () => {
    await channel.start();
    await channel.stop();
    expect(channel.isConnected()).toBe(false);
  });

  it('sendMessage() sends POST to Slack API', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await channel.sendMessage('C12345', 'Hello world');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test-token',
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual({ channel: 'C12345', text: 'Hello world' });
  });

  it('sendMessage() throws on Slack API error', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    } as Response);

    await expect(channel.sendMessage('C12345', 'Hello')).rejects.toThrow('Slack API error');
  });

  it('sendMessage() throws on HTTP error', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    await expect(channel.sendMessage('C12345', 'Hello')).rejects.toThrow(
      'Slack API request failed',
    );
  });
});

describe('verifySlackSignature', () => {
  it('verifies valid signature', () => {
    const signingSecret = 'test-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = '{"type":"event_callback"}';

    const base = `v0:${timestamp}:${rawBody}`;
    const digest = createHmac('sha256', signingSecret).update(base).digest('hex');
    const signature = `v0=${digest}`;

    expect(verifySlackSignature(signingSecret, timestamp, rawBody, signature)).toBe(true);
  });

  it('rejects invalid signature', () => {
    const result = verifySlackSignature('secret', '1234567890', 'body', 'v0=invalid');
    expect(result).toBe(false);
  });

  it('rejects old timestamps', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 400 seconds ago
    expect(verifySlackSignature('secret', oldTimestamp, 'body', 'v0=anything')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DiscordChannel tests
// ---------------------------------------------------------------------------

describe('DiscordChannel', () => {
  let channel: DiscordChannel;
  let mockChannelManager: ChannelManager;

  beforeEach(() => {
    mockChannelManager = {
      handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelManager;

    channel = new DiscordChannel({
      applicationId: 'app-123',
      publicKey: 'a'.repeat(64), // 32 bytes hex = 64 chars
      token: 'bot-token',
      channelManager: mockChannelManager,
    });
  });

  it('start() marks channel as connected', async () => {
    expect(channel.isConnected()).toBe(false);
    await channel.start();
    expect(channel.isConnected()).toBe(true);
  });

  it('stop() marks channel as disconnected', async () => {
    await channel.start();
    await channel.stop();
    expect(channel.isConnected()).toBe(false);
  });

  it('sendMessage() sends POST to Discord API', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
    } as Response);

    await channel.sendMessage('123456789', 'Hello Discord');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/123456789/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bot bot-token',
        }),
      }),
    );
  });

  it('sendMessage() throws on Discord API error', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'Missing permissions',
    } as Response);

    await expect(channel.sendMessage('123', 'Hello')).rejects.toThrow(
      'Failed to send Discord message',
    );
  });
});

describe('verifyDiscordSignature', () => {
  it('rejects old timestamps', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const result = verifyDiscordSignature('a'.repeat(64), 'sig', oldTimestamp, 'body');
    expect(result).toBe(false);
  });

  it('rejects invalid timestamp format', () => {
    expect(verifyDiscordSignature('a'.repeat(64), 'sig', 'not-a-number', 'body')).toBe(false);
  });

  it('handles invalid public key gracefully', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    // Should return false rather than throwing
    expect(verifyDiscordSignature('invalid', 'sig', timestamp, 'body')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TelegramChannel tests
// ---------------------------------------------------------------------------

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  let mockChannelManager: ChannelManager;

  beforeEach(() => {
    mockChannelManager = {
      handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelManager;

    channel = new TelegramChannel({
      token: '123456:ABC-DEF',
      channelManager: mockChannelManager,
    });
  });

  it('start() marks channel as connected', async () => {
    expect(channel.isConnected()).toBe(false);
    await channel.start();
    expect(channel.isConnected()).toBe(true);
  });

  it('stop() marks channel as disconnected', async () => {
    await channel.start();
    await channel.stop();
    expect(channel.isConnected()).toBe(false);
  });

  it('sendMessage() sends POST to Telegram API', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await channel.sendMessage('123456789', 'Hello Telegram');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123456:ABC-DEF/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Hello Telegram'),
      }),
    );
  });

  it('sendMessage() throws on Telegram API error', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
    } as Response);

    await expect(channel.sendMessage('123', 'Hello')).rejects.toThrow('Telegram API error');
  });

  it('sendMessage() throws on HTTP error', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(channel.sendMessage('123', 'Hello')).rejects.toThrow(
      'Telegram API request failed',
    );
  });
});

describe('verifyTelegramWebhook', () => {
  it('verifies matching secrets', () => {
    const secret = 'my-webhook-secret';
    expect(verifyTelegramWebhook(secret, secret)).toBe(true);
  });

  it('rejects non-matching secrets', () => {
    expect(verifyTelegramWebhook('secret1', 'secret2')).toBe(false);
  });

  it('rejects secrets of different lengths', () => {
    expect(verifyTelegramWebhook('short', 'much-longer-secret')).toBe(false);
  });
});
