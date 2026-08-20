// ── Teslimat: bölge ve teslimat tarihi DTO'ları ───────────────────────────────
import type { DeliveryDateStatus, DeliveryDay, DeliveryDaySlug } from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDate, IsoDateTime } from './common';

/** DeliveryZone — kargo ücreti ve ücretsiz eşiğin TEK sahibi (ADR-0005) [B11]. */
export interface DeliveryZone {
  id: Id;
  name: string;
  slug: string;
  /** Kargo ücreti (TL, KDV dahil) — products.js DELIVERY_FEE 49. */
  fee: Money;
  /** Ücretsiz kargo eşiği; null = eşik yok. */
  freeThreshold: Money | null;
  /** Günlük kapasite; varsayılan 999 (fiilen sınırsız), ops düşürür [B9]. */
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}

/** Admin `CRUD /admin/delivery/zones` giriş gövdesi. */
export interface DeliveryZoneInput {
  name: string;
  slug: string;
  fee: Money;
  freeThreshold?: Money | null;
  capacityPerDay?: number;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * `GET /delivery/dates?zone=&weeks=4` ve bootstrap `deliveryDates` öğesi [B9][B49].
 * `day` frontend gün kimliğidir (cart.js `CUTOFF_WEEKDAY` anahtarları), `cutoffAtIso` mutlak kesim anı —
 * cart.js'teki 23:59 / `getHours()>=12` kuralları F9'da bununla değiştirilir.
 */
export interface DeliveryDate {
  day: DeliveryDaySlug;
  date: IsoDate;
  cutoffAtIso: IsoDateTime;
  /** Kesim geçti (cutoffAt <= now) ya da status != OPEN. */
  locked: boolean;
  /** reserved >= capacity → checkout 409 `DAY_FULL`. */
  full: boolean;
}

/** Admin `GET/PATCH /admin/delivery/dates` satırı. */
export interface DeliveryDateAdmin {
  id: Id;
  zoneId: Id;
  zoneName?: string;
  day: DeliveryDay;
  date: IsoDate;
  cutoffAt: IsoDateTime;
  capacity: number;
  reserved: number;
  status: DeliveryDateStatus;
}

/** Admin `PATCH /admin/delivery/dates/:id` — kapasite / kapat. */
export interface DeliveryDatePatch {
  capacity?: number;
  status?: DeliveryDateStatus;
}
