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

  stop(): Promise<void> {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.connected = false;
    return Promise.resolve();
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

  editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    // no-op: sent emails cannot be edited
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
