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

// ── F8 ekleri (CouponsModule + checkout kupon uygulaması) — yalnız EKLEME ─────────────────────────────────────────
// Kupon doğrulama CouponsService.validate (apps/api modules/coupons); indirim hesabı PricingService.quote içinde (ADR-0018 yuvarlama).
// Admin ekranı "Kuponlar" (F8 D): GET /admin/coupons?q&active&page · GET /admin/coupons/:id (+ redemptions) · POST · PUT · DELETE (soft) · PATCH /:id/active

/** Kuponun reddedilme nedeni (makine kodu; Türkçe metin `COUPON_REJECT_MESSAGES`). */
export type CouponRejectReason =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT'
  | 'PER_USER_LIMIT'
  | 'MIN_SUBTOTAL'
  | 'SCOPE_MISMATCH'
  | 'LOGIN_REQUIRED'
  | 'NO_DISCOUNT';

export const COUPON_REJECT_MESSAGES: Readonly<Record<CouponRejectReason, string>> = {
  NOT_FOUND: 'Böyle bir kupon kodu yok.',
  INACTIVE: 'Bu kupon artık kullanımda değil.',
  NOT_STARTED: 'Bu kupon henüz başlamadı.',
  EXPIRED: 'Bu kuponun süresi dolmuş.',
  USAGE_LIMIT: 'Bu kuponun kullanım hakkı dolmuş.',
  PER_USER_LIMIT: 'Bu kuponu daha önce kullandın.',
  MIN_SUBTOTAL: 'Bu kupon için sepet tutarı yeterli değil.',
  SCOPE_MISMATCH: 'Bu kupon sepetindeki ürünlerde geçerli değil.',
  LOGIN_REQUIRED: 'Kuponu kullanmak için giriş yapmalısın.',
  NO_DISCOUNT: 'Bu kupon sepetine indirim sağlamıyor.',
};

/** `CouponsService.validate(code, ctx)` sonucu — geçerliyse kupon kaydı + indirim uygulanacak alan (api hesaplar). */
export interface CouponValidationResult {
  valid: boolean;
  reason: CouponRejectReason | null;
  message: string;
  /** Geçerliyse kupon (admin DTO biçimi); değilse null. */
  coupon: Coupon | null;
  /** Hesaplanan indirim (TL) — `validate`'e `eligible` tutar verildiyse; yoksa 0. */
  discount: Money;
}

/** Admin `GET /admin/coupons?q&active&page&limit`. */
export interface CouponListQuery {
  q?: string;
  active?: boolean;
  page?: number;
  limit?: number;
}

export interface CouponList {
  items: CouponListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Kupon detayındaki kullanım satırı (sipariş no + durum + müşteri e-postası). */
export interface CouponRedemptionListItem extends CouponRedemption {
  orderNo: number;
  orderStatus: string;
  userEmail: string | null;
}

/** Admin `GET /admin/coupons/:id` — kupon + kullanımlar (yeni → eski). */
export interface CouponDetail extends Coupon {
  deletedAt: IsoDateTime | null;
  redemptions: CouponRedemptionListItem[];
}

/** Admin `PATCH /admin/coupons/:id/active {isActive}`. */
export interface CouponActivePatch {
  isActive: boolean;
}
