import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EmailChannel } from '../../src/channels/email.js';

// ---------------------------------------------------------------------------
// Mock nodemailer with hoisted variables (avoids `as any`)
// ---------------------------------------------------------------------------

const { mockVerify, mockSendMail, mockClose, mockCreateTransport } = vi.hoisted(() => {
  const mockVerify = vi.fn().mockResolvedValue(true);
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
  const mockClose = vi.fn();
  const mockCreateTransport = vi.fn(() => ({
    verify: mockVerify,
    sendMail: mockSendMail,
    close: mockClose,
  }));
  return { mockVerify, mockSendMail, mockClose, mockCreateTransport };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const config = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: { user: 'test@example.com', pass: 'password' },
  from: 'alerts@example.com',
  to: ['admin@example.com'],
};

// ---------------------------------------------------------------------------
// EmailChannel tests
// ---------------------------------------------------------------------------

describe('EmailChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults after clearAllMocks (implementations persist but reset for safety)
    mockVerify.mockResolvedValue(true);
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
  });

  it('connects successfully', async () => {
    const channel = new EmailChannel(config);
    await channel.start();
    expect(channel.isConnected()).toBe(true);
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'test@example.com', pass: 'password' },
    });
  });

  it('sends message to configured recipients', async () => {
    const channel = new EmailChannel(config);
    await channel.start();
    await channel.sendMessage('ignored-channel-id', 'Test alert message');
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'alerts@example.com',
      to: 'admin@example.com',
      subject: 'OpenLander Notification',
      text: 'Test alert message',
    });
  });

  it('handles connection failure gracefully', async () => {
    mockVerify.mockRejectedValueOnce(new Error('Connection refused'));

    const channel = new EmailChannel(config);
    await channel.start();
    expect(channel.isConnected()).toBe(false);
  });

  it('editMessage is a no-op', async () => {
    const channel = new EmailChannel(config);
    await channel.start();
    await channel.editMessage('ch', 'msg-id', 'new text');
  });

  it('throws when sending without connection', async () => {
    const channel = new EmailChannel(config);
    // Don't call start()
    await expect(channel.sendMessage('ch', 'msg')).rejects.toThrow(
      'Email transport is not connected',
    );
  });

  it('stop closes transport and disconnects', async () => {
    const channel = new EmailChannel(config);
    await channel.start();
    expect(channel.isConnected()).toBe(true);
    await channel.stop();
    expect(channel.isConnected()).toBe(false);
    expect(mockClose).toHaveBeenCalled();
  });
});
