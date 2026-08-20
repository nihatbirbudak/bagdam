import type { MailLogItem, MailStatus } from '@bagdam/shared';
import { MAIL_PREVIEW_ERROR_PREFIX } from './mail.constants';
import type { MailLogRecord } from './mail.repository';

/** `preview:<dosya>` hata alanından önizleme yolunu çıkarır (yalnız DISABLE_MAIL satırları). */
export function previewPathOf(error: string | null): string | null {
  if (!error || !error.startsWith(MAIL_PREVIEW_ERROR_PREFIX)) return null;
  const path = error.slice(MAIL_PREVIEW_ERROR_PREFIX.length).trim();
  return path.length > 0 ? path : null;
}

/**
 * MailLog → admin satırı. Önizleme yolu yalnız production dışında açıklanır (dosya yolu sunucu bilgisi sayılır);
 * production'da `previewPath` null ve `error` alanındaki `preview:` satırı da gizlenir.
 */
export function toMailLogItem(row: MailLogRecord, exposePreview: boolean = process.env.NODE_ENV !== 'production'): MailLogItem {
  const preview = previewPathOf(row.error);
  return {
    id: row.id,
    to: row.to,
    subject: row.subject,
    templateSlug: row.templateSlug,
    entityId: row.entityId,
    status: row.status as MailStatus,
    error: preview ? (exposePreview ? row.error : null) : row.error,
    messageId: row.messageId,
    previewPath: exposePreview ? preview : null,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}
