// ── Kupon DTO'ları (F7 — minimal kupon şeması; admin/checkout UI P2, ADR-0016) ─
// Kaynak: database/schema.prisma `Coupon` / `CouponRedemption` (0003_commerce). Prisma kaynak; alanlar birebir.
// Kupon kodu `Order.couponCode`'a snapshot olarak yazılır; Coupon'a FK YOK — bağ `CouponRedemption` (sipariş başına ≤1).
// Şema-var/UI-yok: kod girişi (sepet) ve admin ekranı 23 (Kuponlar) P2'de; bu tipler o gün için hazır bekler.
import type { CouponKind, CouponScope } from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDateTime } from './common';

/** Coupon — `code` citext (büyük/küçük harf duyarsız benzersiz). */
export interface Coupon {
  id: Id;
  code: string;
  kind: CouponKind;
  /** PERCENT: yüzde (0–100) · AMOUNT: TL (KDV dahil). */
  value: number;
  /** İndirim öncesi ara toplam alt sınırı (TL); null = sınır yok. */
  minSubtotal: Money | null;
  /** ALL tüm sepet · SINGLE tekil ürün satırları · BOX kutu / abonelik satırı. */
  appliesTo: CouponScope;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  /** Toplam kullanım sınırı; null = sınırsız. */
  usageLimit: number | null;
  /** Üye başına kullanım sınırı; null = sınırsız. */
  perUserLimit: number | null;
  usedCount: number;
  isActive: boolean;
  note: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Admin `POST /admin/coupons` · `PUT /admin/coupons/:id` gövdesi (P2). */
export interface CouponInput {
  code: string;
  kind: CouponKind;
  value: number;
  minSubtotal?: Money | null;
  /** Varsayılan ALL. */
  appliesTo?: CouponScope;
  startsAt?: IsoDateTime | null;
  endsAt?: IsoDateTime | null;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  /** Varsayılan true. */
  isActive?: boolean;
  note?: string | null;
}

/** Admin `GET /admin/coupons` satırı (P2). */
export interface CouponListItem {
  id: Id;
  code: string;
  kind: CouponKind;
  value: number;
  appliesTo: CouponScope;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

/** CouponRedemption — sipariş başına en fazla 1 (orderId unique); `amount` uygulanan indirim (TL). */
export interface CouponRedemption {
  id: Id;
  couponId: Id;
  /** Okuma kolaylığı (join); DB'de yalnız couponId. */
  couponCode?: string;
  orderId: Id;
  orderNo?: number;
  userId: Id | null;
  amount: Money;
  createdAt: IsoDateTime;
}

/** Checkout'ta kupon doğrulama sonucu (`POST /checkout/quote` içinde; P2) — hesap PricingService'te. */
export interface CouponApplication {
  code: string;
  kind: CouponKind;
  appliesTo: CouponScope;
  /** Uygulanan indirim tutarı (TL, kuruşa yuvarlı). */
  amount: Money;
}
