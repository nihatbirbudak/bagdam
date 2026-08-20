import type { MailStatus } from '@bagdam/shared';

/**
 * MailService.send girdisi — şablon slug'ı SiteContent `mail.<slug>`; `vars` Handlebars bağlamı (brand otomatik eklenir);
 * `entityId` verilirse MailLog (templateSlug, entityId) tekildir → aynı varlığa yeniden gönderim satırı GÜNCELLER
 * (son durum; createdAt/sentAt tazelenir). Verilmezse her gönderim yeni satır.
 */
export interface MailSendInput {
  to: string;
  templateSlug: string;
  vars?: Record<string, unknown>;
  entityId?: string | null;
}

export interface MailSendResult {
  logId: string;
  status: MailStatus;
  messageId: string | null;
  /** DISABLE_MAIL: yazılan önizleme dosyasının mutlak yolu. */
  previewPath: string | null;
  error: string | null;
}

/** Şablon render sonucu. */
export interface RenderedMail {
  subject: string;
  html: string;
}

/** Çözümlenmiş SMTP yapılandırması (Setting mail.* → .env SMTP_* sırası). */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  /** Hangi kaynaktan geldi (log için). */
  source: 'settings' | 'env';
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  from: string;
}

export interface TransportSendResult {
  messageId: string | null;
}

/** Taşıyıcı soyutlaması — SmtpTransport (nodemailer) üretimde; testlerde sahte taşıyıcı takılabilir. */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<TransportSendResult>;
}
