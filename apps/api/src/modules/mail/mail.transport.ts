import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { MailTransport, OutgoingMail, SmtpConfig, TransportSendResult } from './mail.types';

/** nodemailer'ın kullanılan yüzeyi (paket çalışma anında `require` ile çözülür; kurulu değilse açık hata). */
interface NodemailerTransporter {
  sendMail(options: { from: string; to: string; subject: string; html: string }): Promise<{ messageId?: string }>;
}
interface NodemailerLike {
  createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
    pool?: boolean;
    maxConnections?: number;
    maxMessages?: number;
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
  }): NodemailerTransporter;
}

export class MailTransportError extends Error {
  constructor(
    readonly code: 'MAIL_CONFIG_MISSING' | 'MAIL_TRANSPORT_UNAVAILABLE' | 'MAIL_SEND_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'MailTransportError';
  }
}

/** Çalışma anında nodemailer'ı çözer; paket yoksa null (DISABLE_MAIL açıkken hiç gerekmez). */
function loadNodemailer(): NodemailerLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('nodemailer') as NodemailerLike;
  } catch {
    return null;
  }
}

/** `Ad <adres>` biçimi (ad boşsa yalnız adres). */
export function formatFrom(from: string, fromName: string): string {
  const name = fromName.trim().replace(/["<>]/g, '');
  return name ? `"${name}" <${from}>` : from;
}

/**
 * SmtpTransport — nodemailer ile SMTP (ADR-0014): yapılandırma Setting `mail.*` (şifreli parola çözülmüş) → yoksa
 * .env `SMTP_*` (B33 fallback). Bağlantı havuzu (pool) yapılandırma özeti değişmedikçe yeniden kullanılır.
 * nodemailer kurulu değilse gönderim MAIL_TRANSPORT_UNAVAILABLE ile başarısız olur (MailLog FAILED + açık mesaj);
 * DISABLE_MAIL=true ortamlarda bu sınıfa hiç gelinmez.
 */
@Injectable()
export class SmtpTransport implements MailTransport {
  private readonly logger = new Logger(SmtpTransport.name);
  private cached: { key: string; transporter: NodemailerTransporter } | null = null;

  constructor(private readonly settings: SettingsService) {}

  /** Setting mail.* (host dolu ise) → .env SMTP_* → null. */
  async resolveConfig(): Promise<SmtpConfig | null> {
    const mail = await this.settings.getMail().catch((err: Error) => {
      this.logger.warn(`mail ayarları okunamadı, .env SMTP_* deneniyor: ${err.message}`);
      return null;
    });
    if (mail && mail.host && mail.host.trim() && mail.from && mail.from.trim()) {
      const port = Number(mail.port) || 587;
      return {
        host: mail.host.trim(),
        port,
        secure: port === 465,
        user: mail.user ?? '',
        pass: mail.pass ?? '',
        from: mail.from.trim(),
        fromName: mail.fromName ?? '',
        source: 'settings',
      };
    }
    const env = process.env;
    const host = (env.SMTP_HOST ?? '').trim();
    const from = (env.SMTP_FROM ?? '').trim();
    if (!host || !from) return null;
    const port = Number(env.SMTP_PORT) || 587;
    return {
      host,
      port,
      secure: port === 465,
      user: env.SMTP_USER ?? '',
      pass: env.SMTP_PASS ?? '',
      from,
      fromName: mail?.fromName ?? env.SMTP_FROM_NAME ?? 'Bağdam',
      source: 'env',
    };
  }

  async send(mail: OutgoingMail): Promise<TransportSendResult> {
    const cfg = await this.resolveConfig();
    if (!cfg) {
      throw new MailTransportError('MAIL_CONFIG_MISSING', 'SMTP yapılandırması yok (Ayarlar › E-posta ya da .env SMTP_HOST/SMTP_FROM)');
    }
    const transporter = this.getTransporter(cfg);
    try {
      const info = await transporter.sendMail({ from: mail.from || formatFrom(cfg.from, cfg.fromName), to: mail.to, subject: mail.subject, html: mail.html });
      return { messageId: info.messageId ?? null };
    } catch (err) {
      throw new MailTransportError('MAIL_SEND_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  /** Gönderen başlığı (MailService gövdeyi kurarken kullanır). */
  async defaultFrom(): Promise<string | null> {
    const cfg = await this.resolveConfig();
    return cfg ? formatFrom(cfg.from, cfg.fromName) : null;
  }

  private getTransporter(cfg: SmtpConfig): NodemailerTransporter {
    const key = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.secure ? 's' : 'p'}`;
    if (this.cached && this.cached.key === key) return this.cached.transporter;
    const nodemailer = loadNodemailer();
    if (!nodemailer) {
      throw new MailTransportError(
        'MAIL_TRANSPORT_UNAVAILABLE',
        'nodemailer paketi kurulu değil — `pnpm --filter @bagdam/api add nodemailer` (DISABLE_MAIL=true iken gerekmez)',
      );
    }
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    this.cached = { key, transporter };
    this.logger.log(`SMTP taşıyıcısı hazır (${cfg.source}: ${cfg.host}:${cfg.port})`);
    return transporter;
  }
}
