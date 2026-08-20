import type { Money, ZoneShippingRule } from '@bagdam/shared';
import type { Prisma } from '@prisma/client';

/** Prisma Decimal(12,2) → number (TL, kuruş); null/undefined → 0. */
export function decimalToMoney(value: Prisma.Decimal | number | null | undefined): Money {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
}

/** DeliveryZone satırı → fiyatlama kargo kuralı (TEK sahip DeliveryZone, ADR-0005 [B11]). */
export function toZoneShippingRule(zone: { fee: Prisma.Decimal | number; freeThreshold: Prisma.Decimal | number | null }): ZoneShippingRule {
  return {
    fee: decimalToMoney(zone.fee),
    freeThreshold: zone.freeThreshold === null ? null : decimalToMoney(zone.freeThreshold),
  };
}

/** Abonelik siparişinde kargo her zaman 0 → bölge çözülemediğinde kullanılan nötr kural (yalnız SUBSCRIPTION/cycle#n için). */
export const NO_SHIPPING_ZONE: Readonly<ZoneShippingRule> = { fee: 0, freeThreshold: null };
