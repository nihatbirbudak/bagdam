import type { AdminCustomerConsent, ConsentKind, MeAddress, MeConsent, PaymentMethod, PaymentProvider } from '@bagdam/shared';
import type { PaymentMethodRecord } from '../payments/payments.repository';
import type { AddressRecord, ConsentRecord } from './me.repository';

/** Address (+zone) → `GET/PUT /me/address` DTO'su. */
export function toMeAddress(row: AddressRecord): MeAddress {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    line: row.line,
    zoneId: row.zoneId,
    zoneSlug: row.zone.slug,
    zip: row.zip,
    isDefault: row.isDefault,
  };
}

export function toMeConsent(row: ConsentRecord): MeConsent {
  return { kind: row.kind as ConsentKind, granted: row.granted, createdAt: row.createdAt.toISOString() };
}

/** Tür başına en son kayıt (satırlar yeni → eski sıralı gelir). */
export function latestConsentPerKind(rows: ConsentRecord[]): MeConsent[] {
  const seen = new Set<string>();
  const out: MeConsent[] = [];
  for (const row of rows) {
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    out.push(toMeConsent(row));
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}

/** Admin müşteri detayındaki onay satırı (tam geçmiş). */
export function toAdminConsent(row: ConsentRecord): AdminCustomerConsent {
  return {
    id: row.id,
    kind: row.kind as ConsentKind,
    granted: row.granted,
    documentId: row.documentId,
    documentSlug: row.document?.slug ?? null,
    documentVersion: row.document?.version ?? null,
    source: row.source,
    iysStatus: row.iysStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/** PaymentMethod → `GET /me/cards` DTO'su (yalnız PSP token özeti: bin/last4/brand/son kullanma; token'lar ASLA çıkmaz). */
export function toPaymentMethodDto(row: PaymentMethodRecord): PaymentMethod {
  return {
    id: row.id,
    provider: row.provider as PaymentProvider,
    bin: row.bin,
    last4: row.last4,
    brand: row.brand,
    holderName: row.holderName,
    expMonth: row.expMonth,
    expYear: row.expYear,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}
