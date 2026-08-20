// ── İndirimler: ilk-2-kutu %50, retention %50 (ADR-0007) + DELTA Order fiyatlaması (ADR-0006) ──
// Uygulanma sırası (state-machines §8 adım 2): ilk-kutu hakkı varsa O uygulanır; yoksa retention; ÜST ÜSTE BİNMEZ.
// İndirim yalnız BOX satırına iner (ekstralar ve tekil ürünler tam fiyat — kutu.html: tier fiyatı yarıya, extras +).
// "Üye başına 1 kez" (User.firstBoxesPromoUsedAt / retentionOfferUsedAt) ÇAĞIRANIN sorumluluğu: hak yoksa
// `firstBoxesLeft: 0` / `retentionPct: null` verilir. Yuvarlama: kuruşa (649 × %50 = 324,50 — prototip ekranda
// Math.round ile 325 gösterir; DB Decimal(12,2) olduğundan kuruş esas alınır, gösterim F9'da formatMoneyTr).
import { OrderLineKind } from '../enums';
import type { Money, PricingContext, PricingLineInput, PricingNote, PricingResult } from '../types/pricing';
import { COMMERCE_SETTINGS_DEFAULTS } from '../types/settings';
import { applyVat, priceLines, subtotalOf } from './lines';
import { discountAmount, roundMoney, sumMoney } from './money';
import { resolveOrderKind } from './order-kind';

export interface FirstBoxesDiscountInput {
  /** Kutu satırı toplamı (tier fiyatı × 1), KDV dahil. */
  boxTotal: Money;
  /** Kalan indirimli kutu hakkı (`Subscription.discountBoxesLeft`); ≤ 0 → indirim yok. */
  firstBoxesLeft: number;
  /** Yüzde; yoksa Setting varsayılanı (50). */
  pct?: number;
}

/** İlk kutular indirimi: hak kaldıysa kutu satırına `pct`; yoksa 0. */
export function firstBoxesDiscount(input: FirstBoxesDiscountInput): Money {
  const pct = input.pct ?? COMMERCE_SETTINGS_DEFAULTS.firstBoxDiscount.pct;
  if (!Number.isInteger(input.firstBoxesLeft)) throw new RangeError('firstBoxesDiscount: firstBoxesLeft tam sayı olmalı');
  if (input.firstBoxesLeft <= 0 || pct <= 0 || input.boxTotal <= 0) return 0;
  return discountAmount(input.boxTotal, pct);
}

export interface RetentionDiscountInput {
  boxTotal: Money;
  /** `Subscription.nextBoxDiscountPct` (retention kabulünde 50); null/0 → indirim yok. */
  retentionPct: number | null;
}

/** Retention (iptalden vazgeçme) indirimi: bir sonraki kutuya `retentionPct`; yoksa 0. */
export function retentionDiscount(input: RetentionDiscountInput): Money {
  if (input.retentionPct === null || input.retentionPct <= 0 || input.boxTotal <= 0) return 0;
  return discountAmount(input.boxTotal, input.retentionPct);
}

export type BoxDiscountKind = 'FIRST_BOXES' | 'RETENTION';
export interface BoxDiscountResult {
  amount: Money;
  kind: BoxDiscountKind | null;
  pct: number;
}

/**
 * Kutu satırına uygulanacak indirimi çözer: önce ilk-kutu hakkı, yoksa retention; ikisi birden ASLA.
 * Yalnız abonelik (SUBSCRIPTION) siparişinde çağrılır; tek seferlik kutuda indirim yok (kutu.html `isFirst = type==="subscription"`).
 */
export function resolveBoxDiscount(
  boxTotal: Money,
  ctx: Pick<PricingContext, 'firstBoxesLeft' | 'retentionPct' | 'firstBoxPct'>,
): BoxDiscountResult {
  const firstPct = ctx.firstBoxPct ?? COMMERCE_SETTINGS_DEFAULTS.firstBoxDiscount.pct;
  const first = firstBoxesDiscount({ boxTotal, firstBoxesLeft: ctx.firstBoxesLeft, pct: firstPct });
  if (first > 0) return { amount: first, kind: 'FIRST_BOXES', pct: firstPct };
  const retention = retentionDiscount({ boxTotal, retentionPct: ctx.retentionPct });
  if (retention > 0) return { amount: retention, kind: 'RETENTION', pct: ctx.retentionPct ?? 0 };
  return { amount: 0, kind: null, pct: 0 };
}

/**
 * DELTA Order (ADR-0006): cycle#1 peşin ödendikten sonra kesimden önce eklenen ekstralar için AYRI küçük sipariş.
 * Yalnız EXTRA satırı kabul eder; kargo 0 (kutuyla gelir), indirim yok (indirim kutuya aittir), KDV satır bazlı.
 * Order.kind abonelikten miras: `isSubscriptionCheckout` ? SUBSCRIPTION : BOX_ONE_TIME.
 */
export function computeDeltaOrder(
  extraLines: readonly PricingLineInput[],
  ctx: Pick<PricingContext, 'isSubscriptionCheckout' | 'vatRateDefault'>,
): PricingResult {
  if (extraLines.some((l) => l.kind !== OrderLineKind.EXTRA)) {
    throw new TypeError('computeDeltaOrder: DELTA siparişte yalnız EXTRA satırı olabilir');
  }
  // DELTA'da kutu satırı yok; tür kutunun türünden miras alınır (EXTRA → abonelik/tek seferlik).
  const orderKind = resolveOrderKind(extraLines.length ? extraLines : [{ kind: OrderLineKind.EXTRA }], ctx);
  const lines = priceLines(extraLines, ctx.vatRateDefault);
  const subtotal = subtotalOf(lines);
  const vatTotal = applyVat(lines);
  const notes: PricingNote[] = [
    { code: 'DELTA_NO_SHIPPING', message: 'Ekstralar kutunla birlikte teslim edilir — kargo yok.' },
  ];
  if (lines.length === 0) notes.unshift({ code: 'EMPTY', message: 'Sepet boş.' });
  return {
    orderKind,
    lines,
    subtotal,
    discountTotal: 0,
    shippingFee: 0,
    vatTotal,
    grandTotal: roundMoney(subtotal),
    prepaidAmount: null,
    notes,
  };
}

/** Σ indirim (kuruşa). */
export function totalDiscount(amounts: readonly Money[]): Money {
  return sumMoney(amounts);
}
