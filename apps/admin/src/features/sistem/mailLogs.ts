/**
 * E-posta günlüğü (MailLog) + test gönderimi yanıtı — saf yardımcılar (test edilir).
 *
 * Sözleşme (A): `GET /admin/mail-logs?page&limit&status&to` → `{items,total}` (MailLog satırı birebir);
 * DISABLE_MAIL'de MailLog.status=SKIPPED ve `error = "preview:<dosya>"` (render edilmiş HTML, yalnız dev).
 * `POST /admin/settings/mail/test {to}` → MailService.send sonucu (MailLog satırı ya da `{status,…}` özeti).
 */
import { MAIL_STATUS_LABELS, type MailStatus } from '@bagdam/shared';
import type { AdminMailLog, AdminMailSendResult } from '../../lib/apiTypes';

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export const MAIL_PREVIEW_PREFIX = 'preview:';

/** `error` alanı `preview:<dosya>` ise dosya yolunu döner (DISABLE_MAIL önizlemesi); değilse null. */
export function parseMailPreview(error: string | null | undefined): string | null {
  if (!error || !error.startsWith(MAIL_PREVIEW_PREFIX)) return null;
  const path = error.slice(MAIL_PREVIEW_PREFIX.length).trim();
  return path || null;
}

/** Önizleme olmayan gerçek hata metni (yoksa null). */
export function mailErrorText(error: string | null | undefined): string | null {
  if (!error) return null;
  return parseMailPreview(error) ? null : error;
}

export function mailStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return (MAIL_STATUS_LABELS as Record<string, string>)[status as MailStatus] ?? status;
}

export function normalizeMailLog(raw: unknown): AdminMailLog | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    to: str(raw.to) ?? '',
    subject: str(raw.subject) ?? '',
    templateSlug: str(raw.templateSlug) ?? '',
    entityId: str(raw.entityId),
    status: str(raw.status) ?? 'QUEUED',
    error: str(raw.error),
    messageId: str(raw.messageId),
    createdAt: str(raw.createdAt) ?? '',
    sentAt: str(raw.sentAt),
  };
}

export type MailSendTone = 'success' | 'info' | 'error';

/**
 * Test gönderimi yanıtını kullanıcı mesajına çevirir: SENT → başarı; SKIPPED (DISABLE_MAIL) → bilgi + önizleme yolu;
 * FAILED → hata; QUEUED → bilgi; tanınmayan şekil → sunucu `message`'ı ya da genel başarı.
 */
export function describeMailSendResult(res: unknown): { tone: MailSendTone; message: string; preview: string | null; status: string | null } {
  const r: AdminMailSendResult = isObj(res) ? (res as AdminMailSendResult) : {};
  const status = typeof r.status === 'string' ? r.status.toUpperCase() : null;
  const preview =
    (typeof r.preview === 'string' && r.preview.trim()) || (typeof r.previewPath === 'string' && r.previewPath.trim()) || parseMailPreview(r.error) || null;
  const to = typeof r.to === 'string' && r.to ? ` → ${r.to}` : '';
  switch (status) {
    case 'SENT':
      return { tone: 'success', message: `Test e-postası gönderildi${to}`, preview, status };
    case 'SKIPPED':
      return {
        tone: 'info',
        message: `Gönderim atlandı (DISABLE_MAIL)${to}${preview ? ` — önizleme: ${preview}` : ''}`,
        preview,
        status,
      };
    case 'FAILED':
      return { tone: 'error', message: `Gönderim başarısız${to}${mailErrorText(r.error) ? `: ${mailErrorText(r.error)}` : ''}`, preview, status };
    case 'QUEUED':
      return { tone: 'info', message: `Kuyruğa alındı${to}`, preview, status };
    default:
      return { tone: 'success', message: typeof r.message === 'string' && r.message ? r.message : 'Test e-postası gönderildi', preview, status };
  }
}
