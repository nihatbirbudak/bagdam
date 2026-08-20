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

// ── F5 ekleri (DeliveryModule) — yalnız EKLEME ────────────────────────────────

/** Public `GET /delivery/zones` öğesi — yalnız aktif bölgeler; kapasite/sıra istemciye gitmez. */
export interface DeliveryZonePublic {
  id: Id;
  slug: string;
  name: string;
  fee: Money;
  freeThreshold: Money | null;
}

/** Public `GET /delivery/dates?zone=&weeks=` sorgusu (zone varsayılan `urla`, weeks varsayılan 4, en çok 12). */
export interface DeliveryDatesQuery {
  zone?: string;
  weeks?: number;
}

/** Admin `PUT /admin/delivery/zones/:id` — tüm alanlar isteğe bağlı (yalnız gönderilenler güncellenir). */
export type DeliveryZoneUpdate = Partial<DeliveryZoneInput>;

/** Admin `PATCH /admin/delivery/zones/:id/active`. */
export interface DeliveryZoneActivePatch {
  isActive: boolean;
}

/** Admin `GET /admin/delivery/dates?zone=&from=&to=` (zone slug; from/to `YYYY-MM-DD`, varsayılan bugün → +ufuk). */
export interface DeliveryDatesAdminQuery {
  zone?: string;
  from?: IsoDate;
  to?: IsoDate;
}

/** Admin `POST /admin/delivery/dates/generate {weeks?}` (varsayılan Setting `commerce.deliveryDatesHorizonWeeks`). */
export interface DeliveryDatesGenerateInput {
  weeks?: number;
}

/** `generate` sonucu — idempotent: ikinci koşuda `created` 0, var olan tarihlerde yalnız day/cutoffAt tazelenir. */
export interface DeliveryDatesGenerateResult {
  weeks: number;
  /** Üretilen ufuk (ilk/son takvim günü); teslimat günü yoksa null. */
  from: IsoDate | null;
  to: IsoDate | null;
  /** İşlenen aktif bölge sayısı. */
  zones: number;
  created: number;
  updated: number;
}
