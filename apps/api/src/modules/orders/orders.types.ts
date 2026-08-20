import type { AddressSnapshot, Money, OrderActor, OrderKind, OrderLineSnapshotInput } from '@bagdam/shared';
import type { Prisma } from '@prisma/client';

/** Prisma interaktif işlem istemcisi — servis imzalarında `tx?` olarak geçer (F8 checkout `$transaction`, C lock-and-charge). */
export type Tx = Prisma.TransactionClient;

/**
 * Fiyat özeti — shared `PricingResult` ile uyumlu alt küme (PricingResult doğrudan verilebilir).
 * Order.{subtotal,discountTotal,shippingFee,vatTotal,grandTotal} bu değerlerden snapshot'lanır (yeniden hesap YOK — tek kaynak PricingService).
 */
export interface OrderQuoteTotals {
  orderKind: OrderKind;
  subtotal: Money;
  discountTotal: Money;
  shippingFee: Money;
  vatTotal: Money;
  grandTotal: Money;
}

/** `OrdersService.createFromQuote` girdisi (F8 checkout + C createFromCheckout bunu kurar). */
export interface CreateOrderFromQuoteInput {
  quote: OrderQuoteTotals;
  /** Snapshot satırları — PricedLine + name/unit/lotCode/metadata (kind PRODUCT | BOX | EXTRA). En az 1 satır. */
  lines: OrderLineSnapshotInput[];
  /** Verilmezse `quote.orderKind` (karışık sepet önceliği ADR-0008). */
  kind?: OrderKind;
  userId: string | null;
  subscriptionId?: string | null;
  /** Müşteri snapshot'ı — customerEmail = User.email (checkout'ta readonly) [B15]; telefon zorunlu [B10]. */
  customer: { name: string; email: string; phone: string };
  /** Adres snapshot'ı — zoneId DeliveryDate.zoneId ile aynı olmalı (400 ZONE_MISMATCH). */
  address: AddressSnapshot;
  /** Rezerve edilecek DeliveryDate (OPEN ve kesimi geçmemiş; dolu → 409 DAY_FULL). */
  deliveryDateId: string;
  couponCode?: string | null;
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Zaman — verilmezse `new Date()` (testler sabitler; ADR-0004: ham SQL'de now() yok). */
  now?: Date;
}

/** Durum geçişi bağlamı (`OrdersService.transition`). */
export interface OrderTransitionContext {
  /** USER (müşteri) · ADMIN/OPS (panel) · SYSTEM (job) · PSP (callback/webhook). */
  actor: OrderActor;
  actorId?: string | null;
  /** CANCELLED / REFUNDED için zorunlu (400 ORDER_REASON_REQUIRED). */
  reason?: string | null;
  now?: Date;
  /**
   * DeliveryDate rezerv iadesi (CANCELLED / PAID→REFUNDED): abonelik siparişlerinde (subscriptionId dolu) rezervin sahibi cycle
   * motorudur ve iadeyi o yapar → varsayılan YOK; yalnız açıkça `true` verilirse iade edilir. Tekil/checkout siparişlerinde
   * (subscriptionId boş) varsayılan iade VAR; `false` ile kapatılır (çift iade olmasın — state-machines §11).
   */
  releaseDeliveryDate?: boolean;
}

/** Cycle referansı — id ya da {id}; servis gerekli ilişkileri kendisi yükler (C'nin include şekline bağımlı değil). */
export type CycleRef = string | { id: string };

/** `createForCycle` / `createDeltaForCycle` seçenekleri. */
export interface CreateForCycleOptions {
  /** cycle.orderId / cycle.deltaOrderId aynı işlemde yazılsın mı (varsayılan true). C kendisi bağlayacaksa false. */
  link?: boolean;
  /** BOX satırının KDV oranı (tier'da KDV alanı yok) — varsayılan shared DEFAULT_VAT_RATE (1); çağıran Setting commerce.vatRate verebilir. */
  vatRate?: number;
  now?: Date;
  ipAddress?: string | null;
}

/** Admin liste/CSV filtresi (DTO → servis çözümlemesi; tarihler UTC instant). */
export interface OrderListFilter {
  status?: string;
  kind?: string;
  userId?: string;
  /** createdAt ≥ (Europe/Istanbul takvim günü başlangıcı). */
  createdFrom?: Date;
  /** createdAt < (bitiş gününün ertesi 00:00). */
  createdToExclusive?: Date;
  /** deliveryOn = (UTC gece yarısı Date). */
  deliveryOn?: Date;
  /** orderNo (sayı) ya da ad/e-posta/telefon içerir. */
  q?: string;
}
