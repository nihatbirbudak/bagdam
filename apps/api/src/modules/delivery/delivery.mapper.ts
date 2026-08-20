import {
  deliveryDayToSlug,
  utcToIsoDate,
  type DeliveryDate,
  type DeliveryDateAdmin,
  type DeliveryZone,
  type DeliveryZonePublic,
  type Money,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import type { DateWithZoneRecord, ZoneRecord } from './delivery.repository';

/** Prisma Decimal(12,2) → number (TL, kuruş hassasiyeti). */
export function toMoney(value: Prisma.Decimal): Money {
  return Number(value.toString());
}

/** Public `GET /delivery/zones` öğesi — kapasite/sıra/aktiflik istemciye gitmez. */
export function toZonePublic(row: ZoneRecord): DeliveryZonePublic {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    fee: toMoney(row.fee),
    freeThreshold: row.freeThreshold ? toMoney(row.freeThreshold) : null,
  };
}

/** Admin DeliveryZone DTO (shared). */
export function toZoneAdmin(row: ZoneRecord): DeliveryZone {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    fee: toMoney(row.fee),
    freeThreshold: row.freeThreshold ? toMoney(row.freeThreshold) : null,
    capacityPerDay: row.capacityPerDay,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/**
 * Public/bootstrap `deliveryDates` öğesi [B9][B49] — catalog.mapper#toDeliveryDate ile AYNI kural
 * (locked = cutoffAt <= now ya da status != OPEN; full = reserved >= capacity). E entegre ederken catalog bunu çağırır.
 */
export function toDeliveryDateDto(row: DateWithZoneRecord, now: Date): DeliveryDate {
  return {
    day: deliveryDayToSlug(row.day),
    date: utcToIsoDate(row.date),
    cutoffAtIso: row.cutoffAt.toISOString(),
    locked: row.cutoffAt.getTime() <= now.getTime() || row.status !== 'OPEN',
    full: row.reserved >= row.capacity,
  };
}

/** Admin `GET/PATCH /admin/delivery/dates` satırı. */
export function toDeliveryDateAdmin(row: DateWithZoneRecord): DeliveryDateAdmin {
  return {
    id: row.id,
    zoneId: row.zoneId,
    zoneName: row.zone.name,
    day: row.day,
    date: utcToIsoDate(row.date),
    cutoffAt: row.cutoffAt.toISOString(),
    capacity: row.capacity,
    reserved: row.reserved,
    status: row.status,
  };
}
