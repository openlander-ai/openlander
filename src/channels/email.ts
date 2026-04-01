import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Channel } from './base.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('email');

export interface EmailConfig {
  host: string;
  port: number;
  /** true for port 465 (implicit TLS), false for STARTTLS (port 587) */
  secure: boolean;
  auth: { user: string; pass: string };
  from: string;
  to: string[];
}

/**
 * Send-only SMTP notification channel. channelId is ignored (uses configured recipients).
 * editMessage is a no-op — sent emails cannot be modified.
 */
export class EmailChannel implements Channel {
  private transport: Transporter | null = null;
  private connected = false;
  private readonly config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    try {
      this.transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.auth.user,
          pass: this.config.auth.pass,
        },
      });

      await this.transport.verify();
      this.connected = true;
      log.info({ host: this.config.host, port: this.config.port }, 'Email channel connected');
    } catch (error) {
      // Graceful failure: log and leave isConnected() false
      this.connected = false;
      log.error(
        { error, host: this.config.host, port: this.config.port },
        'Failed to connect email channel',
      );
    }
  }

  async stop(): Promise<void> {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.connected = false;
  }

  async sendMessage(_channelId: string, text: string): Promise<string> {
    if (!this.transport || !this.connected) {
      throw new Error('Email transport is not connected');
    }

    await this.transport.sendMail({
      from: this.config.from,
      to: this.config.to.join(', '),
      subject: 'OpenLander Notification',
      text,
    });

    return '';
  }

  async editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    // no-op: sent emails cannot be edited
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * SMTP email notification channel.
 *
 * Send-only channel — emails cannot be edited after sending, so editMessage
 * is a no-op. The channelId parameter in sendMessage is ignored; messages are
 * always sent to the configured `to` recipients.
 */
export class EmailChannel implements Channel {
  private transport: Transporter | null = null;
  private connected = false;
  private readonly config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  /**
   * Creates the SMTP transport and verifies connectivity.
   * On failure, logs the error and leaves isConnected() as false.
   */
  async start(): Promise<void> {
    try {
      this.transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.auth.user,
          pass: this.config.auth.pass,
        },
      });

      await this.transport.verify();
      this.connected = true;
      log.info({ host: this.config.host, port: this.config.port }, 'Email channel connected');
    } catch (error) {
      this.connected = false;
      log.error(
        { error, host: this.config.host, port: this.config.port },
        'Failed to connect email channel',
      );
    }
  }

  /**
   * Closes the SMTP transport.
   */
  async stop(): Promise<void> {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.connected = false;
  }

  /**
   * Sends a plain-text email to all configured recipients.
   *
   * @param _channelId - Ignored for email; recipients come from config.
   * @param text - Plain-text message body.
   * @returns Empty string (email has no editable message ID).
   */
  async sendMessage(_channelId: string, text: string): Promise<string> {
    if (!this.transport || !this.connected) {
      throw new Error('Email transport is not connected');
    }

    await this.transport.sendMail({
      from: this.config.from,
      to: this.config.to.join(', '),
      subject: 'OpenLander Notification',
      text,
    });

    return '';
  }

  /**
   * No-op — sent emails cannot be edited.
   */
  async editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    // Emails cannot be edited after sending
  }

  /**
   * Returns whether the SMTP transport is verified and connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
