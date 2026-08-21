import type { WebhookEvent } from '@prisma/client';
import type { WebhookEventItem } from '@bagdam/shared';
import { redactObject } from '../../common/security/redaction';

/**
 * `GET /admin/webhook-events` satırı. `payload` REDAKTE edilerek verilir: PayTR bildirimi
 * `hash` (mağaza anahtarıyla üretilmiş imza) ve e-posta/telefon alanları içerebilir —
 * panelde de ham görünmemeli (ADR-0015 sır sızıntısı + KVKK).
 */
export function toWebhookEventItem(row: WebhookEvent): WebhookEventItem {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.eventType,
    providerRef: row.providerRef,
    payload: (redactObject(row.payload ?? null) as Record<string, unknown> | null) ?? null,
    signatureValid: row.signatureValid,
    status: row.status,
    error: row.error,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}
