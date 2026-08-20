import { SetMetadata } from '@nestjs/common';

/**
 * `@Audited('catalog' | 'media' | 'auth' | …)` — handler ya da controller sınıfına konur; AuditLogInterceptor
 * POST/PUT/PATCH/DELETE isteklerinde AuditLog satırı yazar (GET'ler yok sayılır).
 * Modül adı AuditLog.module kolonuna gider (VarChar(40)); admin listesi buna göre filtreler.
 */
export const AUDIT_MODULE_KEY = 'audit:module';
export const Audited = (moduleName: string) => SetMetadata(AUDIT_MODULE_KEY, moduleName);

/**
 * Servis/controller'ın interceptor'a ilettiği isteğe bağlı değerler — `setAuditValues(req, {...})`.
 * Verilmezse interceptor gövdeyi (redakte ederek) newValues olarak, param `id` ya da yanıt `id`'sini entityId
 * olarak kullanır. oldValues için tek yol budur (güncellemeden önceki kaydı controller okuyup iletir).
 */
export interface AuditValues {
  entityId?: string;
  /** Özet etiketi (ör. ürün adı) — "catalog: UPDATE «İncir»" biçiminde summary üretilir. */
  label?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export const AUDIT_VALUES_KEY = '__auditValues';

type RequestWithAuditValues = { [AUDIT_VALUES_KEY]?: AuditValues };

/** İsteğe audit ipuçlarını takar (daha önce takılanlarla birleşir). */
export function setAuditValues(req: object, values: AuditValues): void {
  const target = req as RequestWithAuditValues;
  target[AUDIT_VALUES_KEY] = { ...(target[AUDIT_VALUES_KEY] ?? {}), ...values };
}

export function getAuditValues(req: object): AuditValues | undefined {
  return (req as RequestWithAuditValues)[AUDIT_VALUES_KEY];
}
