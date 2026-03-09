import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  ChannelManager,
  decodeQuestionComponentValue,
  encodeQuestionComponentValue,
  type Channel,
  type ChannelMessage,
} from '../src/channels/base.js';
import type { AppContext } from '../src/app.js';
import { DiscordChannel, verifyDiscordSignature } from '../src/channels/discord.js';
import { SlackChannel, verifySlackSignature } from '../src/channels/slack.js';
import { TelegramChannel, verifyTelegramWebhook } from '../src/channels/telegram.js';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createMockEventBus() {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createMockQuestionBridge() {
  return {
    reply: vi.fn(),
    reject: vi.fn(),
    hasPending: vi.fn().mockReturnValue(true),
  };
}

function createMockAppContext() {
  return {
    config: {
      channels: {
        slack: { recoveryChannelId: '' },
        discord: { recoveryChannelId: '' },
        telegram: { recoveryChannelId: '' },
      },
    },
    agent: {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'message', content: 'AI response' });
          },
        ),
    },
    questionBridge: createMockQuestionBridge(),
  } as unknown as AppContext;
}

describe('Channel interface', () => {
  it('defines required methods', () => {
    const channel: Channel = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue('msg-1'),
      editMessage: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };

    expect(typeof channel.start).toBe('function');
    expect(typeof channel.stop).toBe('function');
    expect(typeof channel.sendMessage).toBe('function');
    expect(typeof channel.editMessage).toBe('function');
    expect(typeof channel.isConnected).toBe('function');
  });
});

describe('Question component encoding', () => {
  it('encodes and decodes interaction values', () => {
    const encoded = encodeQuestionComponentValue('req_123', 0, 'Deploy now');
    const decoded = decodeQuestionComponentValue(encoded);

    expect(decoded).toEqual({ requestId: 'req_123', questionIndex: 0, value: 'Deploy now' });
  });
});

describe('ChannelManager', () => {
  let manager: ChannelManager;
  let mockCtx: AppContext;
  let mockChannel: Channel;

  beforeEach(() => {
    mockCtx = createMockAppContext();
    manager = new ChannelManager(
      mockCtx,
      createMockEventBus() as unknown as ConstructorParameters<typeof ChannelManager>[1],
    );

    mockChannel = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValueOnce('status-1').mockResolvedValue('status-next'),
      editMessage: vi.fn().mockResolvedValue(undefined),
      sendInteractive: vi.fn().mockResolvedValue('interactive-1'),
      isConnected: vi.fn().mockReturnValue(true),
    };
  });

  function createIncomingMessage(): ChannelMessage {
    return {
      channelType: 'slack',
      sender: 'U1',
      senderName: 'User',
      content: 'hello',
      channelId: 'C1',
      timestamp: new Date(),
    };
  }

  it('streams agent response and edits status message', async () => {
    mockCtx.agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'tool_call', toolName: 'deploy_project', arguments: {} });
            await onEvent({ type: 'message', content: 'Final streamed reply' });
          },
        ),
    } as unknown as AppContext['agent'];

    manager.register('slack', mockChannel);
    await manager.handleIncomingMessage(createIncomingMessage());

    expect(mockCtx.agent?.chatStream).toHaveBeenCalled();
    expect(mockChannel.sendMessage).toHaveBeenCalledWith('C1', '🤔 Thinking...');
    expect(mockChannel.editMessage).toHaveBeenLastCalledWith(
      'C1',
      'status-1',
      'Final streamed reply',
    );
  });

  it('applies edit throttling at 1.5s minimum interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    mockCtx.agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'tool_call', toolName: 'step_a', arguments: {} });
            vi.advanceTimersByTime(1600);
            await onEvent({ type: 'tool_result', toolName: 'step_a', success: true });
            await onEvent({ type: 'message', content: 'done' });
          },
        ),
    } as unknown as AppContext['agent'];

    manager.register('slack', mockChannel);
    await manager.handleIncomingMessage(createIncomingMessage());

    expect(mockChannel.editMessage).toHaveBeenCalledTimes(2);
    expect(mockChannel.editMessage).toHaveBeenNthCalledWith(
      1,
      'C1',
      'status-1',
      '✅ step_a complete',
    );
    expect(mockChannel.editMessage).toHaveBeenNthCalledWith(2, 'C1', 'status-1', 'done');
  });

  it('sends interactive question when question event arrives', async () => {
    mockCtx.agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({
              type: 'question',
              request: {
                id: 'req_1',
                questions: [
                  {
                    question: 'Choose action',
                    options: [{ label: 'Deploy' }, { label: 'Cancel' }],
                    multiple: false,
                  },
                ],
              },
            });
            await onEvent({ type: 'message', content: 'Awaiting your choice completed.' });
          },
        ),
    } as unknown as AppContext['agent'];

    manager.register('slack', mockChannel);
    await manager.handleIncomingMessage(createIncomingMessage());

    expect(mockChannel.sendInteractive).toHaveBeenCalledTimes(1);
    expect(mockChannel.sendInteractive).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('Choose action'),
      expect.arrayContaining([
        expect.objectContaining({ type: 'button', label: 'Deploy' }),
        expect.objectContaining({ type: 'button', label: 'Cancel' }),
      ]),
    );
  });

  it('falls back to sendMessage when editMessage fails', async () => {
    mockCtx.agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'message', content: 'Final result' });
          },
        ),
    } as unknown as AppContext['agent'];

    (mockChannel.editMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('edit failed'),
    );

    manager.register('slack', mockChannel);
    await manager.handleIncomingMessage(createIncomingMessage());

    expect(mockChannel.sendMessage).toHaveBeenNthCalledWith(2, 'C1', 'Final result');
  });

  it('gracefully handles missing agent', async () => {
    manager = new ChannelManager(
      { ...mockCtx, agent: null } as AppContext,
      createMockEventBus() as unknown as ConstructorParameters<typeof ChannelManager>[1],
    );
    manager.register('slack', mockChannel);

    await manager.handleIncomingMessage(createIncomingMessage());

    expect(mockChannel.sendMessage).not.toHaveBeenCalled();
  });
});

describe('SlackChannel', () => {
  let channel: SlackChannel;
  const questionBridge = createMockQuestionBridge();

  beforeEach(() => {
    channel = new SlackChannel({
      token: 'xoxb-token',
      signingSecret: 'secret',
      channelManager: {
        handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChannelManager,
      questionBridge: questionBridge as unknown as ConstructorParameters<
        typeof SlackChannel
      >[0]['questionBridge'],
    });
  });

  it('sendMessage returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: '111.222' }),
    } as Response);

    const messageId = await channel.sendMessage('C1', 'hello');
    expect(messageId).toBe('111.222');
  });

  it('editMessage calls chat.update', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    await channel.editMessage('C1', '111.222', 'updated');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.update',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sendInteractive sends blocks and returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: '333.444' }),
    } as Response);

    const messageId = await channel.sendInteractive?.('C1', 'Choose', [
      { type: 'button', label: 'A', value: 'v1' },
    ]);

    expect(messageId).toBe('333.444');
  });

  it('interaction reply calls questionBridge and edits selected state', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    const encoded = encodeQuestionComponentValue('req_7', 0, 'Deploy');
    await channel.handleInteractionPayload({
      type: 'block_actions',
      channel: { id: 'C1' },
      message: { ts: '444.555' },
      actions: [{ value: encoded }],
    });

    expect(questionBridge.reply).toHaveBeenCalledWith('req_7', [
      { questionIndex: 0, selectedLabels: ['Deploy'] },
    ]);
  });
});

describe('DiscordChannel', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    channel = new DiscordChannel({
      applicationId: 'app',
      publicKey: 'a'.repeat(64),
      token: 'token',
      channelManager: {
        handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChannelManager,
      questionBridge: createMockQuestionBridge() as unknown as ConstructorParameters<
        typeof DiscordChannel
      >[0]['questionBridge'],
    });
  });

  it('sendMessage returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-1' }) } as Response);

    const id = await channel.sendMessage('123', 'hello');
    expect(id).toBe('msg-1');
  });

  it('sendInteractive uses component buttons and returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-2' }) } as Response);

    const id = await channel.sendInteractive?.('123', 'Pick', [
      { type: 'button', label: 'Go', value: 'v1', style: 'primary' },
    ]);
    expect(id).toBe('msg-2');
  });

  it('handleQuestionReply decodes and replies', () => {
    const bridge = createMockQuestionBridge();
    channel = new DiscordChannel({
      applicationId: 'app',
      publicKey: 'a'.repeat(64),
      token: 'token',
      channelManager: {
        handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChannelManager,
      questionBridge: bridge as unknown as ConstructorParameters<
        typeof DiscordChannel
      >[0]['questionBridge'],
    });

    const label = channel.handleQuestionReply(encodeQuestionComponentValue('req_9', 0, 'Ship it'));
    expect(label).toBe('Ship it');
    expect(bridge.reply).toHaveBeenCalledWith('req_9', [
      { questionIndex: 0, selectedLabels: ['Ship it'] },
    ]);
  });
});

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  let bridge: ReturnType<typeof createMockQuestionBridge>;

  beforeEach(() => {
    bridge = createMockQuestionBridge();
    channel = new TelegramChannel({
      token: '123:abc',
      channelManager: {
        handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChannelManager,
      questionBridge: bridge as unknown as ConstructorParameters<
        typeof TelegramChannel
      >[0]['questionBridge'],
    });
  });

  it('sendMessage returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 99 } }),
    } as Response);

    const id = await channel.sendMessage('1', 'hello');
    expect(id).toBe('99');
  });

  it('sendInteractive sends inline keyboard and returns message id', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 100 } }),
    } as Response);

    const id = await channel.sendInteractive?.('1', 'Choose', [
      { type: 'button', label: 'Yes', value: 'v1' },
    ]);

    expect(id).toBe('100');
  });

  it('callback_query reply calls questionBridge and updates selected state', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    await channel.handleCallbackQuery({
      id: 'cb-1',
      data: encodeQuestionComponentValue('req_10', 0, 'Cancel'),
      message: {
        message_id: 7,
        chat: { id: 1, type: 'private' },
        date: 0,
      },
    });

    expect(bridge.reply).toHaveBeenCalledWith('req_10', [
      { questionIndex: 0, selectedLabels: ['Cancel'] },
    ]);
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
});

describe('verifyDiscordSignature', () => {
  it('rejects invalid timestamp format', () => {
    expect(verifyDiscordSignature('a'.repeat(64), 'sig', 'not-a-number', 'body')).toBe(false);
  });
});

describe('verifyTelegramWebhook', () => {
  it('verifies matching secrets', () => {
    expect(verifyTelegramWebhook('secret', 'secret')).toBe(true);
  });
});
