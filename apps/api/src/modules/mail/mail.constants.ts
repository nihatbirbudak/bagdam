import { resolve } from 'path';
import type { MailTemplateSlug } from '@bagdam/shared';
import { APP_ROOT } from '../../config/paths';

/**
 * MailModule sabitleri (F6, ADR-0014). Şablonlar SiteContent'te: anahtar `mail.<slug>` → `{subject, html}` (Handlebars);
 * kaynak liste site-content.registry.ts (grup `mail`) + seed database/seeds/content/site-content.json.
 */
export const MAIL_TEMPLATE_SLUGS: readonly MailTemplateSlug[] = ['welcome', 'verify', 'reset', 'password-changed', 'wholesale-lead', 'test', 'order-paid'];

/** SiteContent anahtar öneki: `mail.welcome` … */
export const MAIL_SITE_CONTENT_PREFIX = 'mail.';

/**
 * DISABLE_MAIL=true: render edilmiş HTML `apps/api/logs/mail/<maillog-id>.html` dosyasına yazılır (gitignore'lu);
 * MailLog.error = `preview:<dosya>` (şema değişikliği yok; e2e/test bunu okuyup linki çıkarır).
 */
export const MAIL_PREVIEW_DIR = resolve(APP_ROOT, 'logs', 'mail');
export const MAIL_PREVIEW_ERROR_PREFIX = 'preview:';

/** MailLog kolon sınırları (VarChar). */
export const MAIL_LOG_LIMITS = { to: 160, subject: 255, templateSlug: 60, entityId: 60, messageId: 160 } as const;

/** Admin `GET /admin/mail-logs` varsayılanları. */
export const MAIL_LOGS_DEFAULT_LIMIT = 25;

/** Parola sıfırlama bağlantısı ömrü (dk) — AuthService ile aynı (şablon `expiresMinutes`). */
export const RESET_LINK_MINUTES = 60;

/** `DISABLE_MAIL` açık mı (lokal/staging varsayılanı true — .env.example). Yalnız tam `true` değeri kapatır. */
export function isMailDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DISABLE_MAIL ?? '').trim().toLowerCase() === 'true';
}

/** WEB_URL (sondaki / atılır); yoksa boş → bağlantılar göreli (/uyelik.html?…) üretilir. */
export function webUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WEB_URL ?? '').trim().replace(/\/+$/, '');
}

/** ADMIN_URL (sondaki / atılır); yoksa WEB_URL. */
export function adminUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ADMIN_URL ?? '').trim().replace(/\/+$/, '');
  return raw || webUrl(env);
}

/** PII: konsol loglarında e-posta maskelenir (MailLog.to tam yazılır — operasyon gereği). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}
