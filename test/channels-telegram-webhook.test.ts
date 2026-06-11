import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { ChannelManager } from '../src/channels/base.js';
import { createTelegramWebhookHandler, TelegramChannel } from '../src/channels/telegram.js';

function createTelegramChannel(params?: {
  handleIncomingMessage?: ReturnType<typeof vi.fn>;
  questionReply?: ReturnType<typeof vi.fn>;
}): TelegramChannel {
  return new TelegramChannel({
    token: '123:abc',
    channelManager: {
      handleIncomingMessage: params?.handleIncomingMessage ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelManager,
    questionBridge: {
      reply: params?.questionReply ?? vi.fn(),
      reject: vi.fn(),
      hasPending: vi.fn().mockReturnValue(true),
    },
  });
}

function createContext(update: unknown, headers: Record<string, string | undefined> = {}): Context {
  return {
    req: {
      header: vi.fn((name: string) => headers[name]),
      json: vi.fn().mockResolvedValue(update),
    },
    json: vi.fn((body: unknown, status?: number) =>
      Response.json(body, { status: status ?? 200 }),
    ),
  } as unknown as Context;
}

describe('Telegram webhook send-only guardrail', () => {
  it('acknowledges text updates without forwarding them to the agent path by default', async () => {
    const handleIncomingMessage = vi.fn().mockResolvedValue(undefined);
    const channel = createTelegramChannel({ handleIncomingMessage });
    const handler = createTelegramWebhookHandler(channel);

    const response = await handler(
      createContext({
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 42, is_bot: false, first_name: 'User', username: 'operator' },
          chat: { id: 100, type: 'private' },
          text: '/redeploy production',
          date: 1_800_000_000,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('acknowledges callback updates without answering questions by default', async () => {
    const questionReply = vi.fn();
    const channel = createTelegramChannel({ questionReply });
    const handler = createTelegramWebhookHandler(channel);

    const response = await handler(
      createContext({
        update_id: 2,
        callback_query: {
          id: 'callback-1',
          data: 'req_1:0:Deploy',
          message: {
            message_id: 11,
            chat: { id: 100, type: 'private' },
            date: 1_800_000_000,
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(questionReply).not.toHaveBeenCalled();
  });

  it('forwards incoming messages only when explicitly enabled', async () => {
    const handleIncomingMessage = vi.fn().mockResolvedValue(undefined);
    const channel = createTelegramChannel({ handleIncomingMessage });
    const handler = createTelegramWebhookHandler(channel, { allowIncoming: true });

    const response = await handler(
      createContext({
        update_id: 3,
        message: {
          message_id: 12,
          from: { id: 42, is_bot: false, first_name: 'User', username: 'operator' },
          chat: { id: 100, type: 'private' },
          text: 'status?',
          date: 1_800_000_000,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'telegram',
        content: 'status?',
        channelId: '100',
      }),
    );
  });
});
