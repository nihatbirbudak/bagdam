// ── Fiyatlama — TEK DOĞRULUK KAYNAĞI (packages/shared/src/pricing) ──────────────
//
// api `PricingService` (F7), admin önizlemeleri ve web quote'u aynı saf fonksiyonları çağırır; kimse kendi
// hesabını yazmaz (ADR-0002). DB/framework yok; girdi = çağıranın çözdüğü gerçekler (PricingContext), çıktı =
// Order alanlarıyla aynı adlandırma (PricingResult). Dosyalar:
//   money.ts      roundMoney (kuruş, yarım yukarı) · vatFromGross (gross×r/(100+r)) · sumMoney · roundExtraPrice (tam TL) · formatMoneyTr
//   lines.ts      satır toplamı + KDV ayrıştırma çekirdeği
//   order-kind.ts Order.kind önceliği SUBSCRIPTION > BOX_ONE_TIME > SINGLE (ADR-0008)
//   shipping.ts   kargo: abone ‖ zone eşik (≥/>: Setting freeShippingRule); değer yalnız DeliveryZone (ADR-0005)
//   discounts.ts  ilk-2-kutu %50 / retention %50 (ADR-0007; yuvarlama Setting discountRounding) + DELTA Order (ADR-0006)
//   rules.ts      fiyatlama kuralları (ADR-0018): Setting commerce.{freeShippingRule,discountRounding,subscriberFreeShipping}
//                 → PricingContext.rules; verilmezse varsayılan (gte / kurus / true)
//   extras.ts     ekstra miktar seçenekleri (Setting extraAmountOptions / Product.extraOptions) + tam TL fiyat
//   cutoff.ts     kesim anı TZ'li (fromZonedTime), teslimat tarihleri, kilitli gün (ADR-0004/0005)
//
// computeQuote sırası: satır toplamları → indirimler (yalnız BOX) → kargo → KDV ayrıştırma (indirim sonrası) → grandTotal.
// Kargo KDV'ye DAHİL DEĞİLDİR (vatTotal yalnız satır KDV'si; kargo KDV oranı kararı açık — ADR gerekirse eklenir).
import { OrderKind, OrderLineKind } from '../enums';
import type { CycleChargeQuote, Money, PricingContext, PricingLineInput, PricingNote, PricingResult, PricingRules, ZoneShippingRule } from '../types/pricing';
import { resolveBoxDiscount } from './discounts';
import { extrasTotal } from './extras';
import { applyVat, priceLines, subtotalOf } from './lines';
import { formatMoneyTr, roundMoney, sumMoney } from './money';
import { resolveOrderKind } from './order-kind';
import { resolvePricingRules } from './rules';
import { computeShipping } from './shipping';

export type { Money, PricingRules } from '../types/pricing';
export * from './money';
export * from './lines';
export * from './order-kind';
export * from './rules';
export * from './shipping';
export * from './discounts';
export * from './extras';
export * from './cutoff';

/**
 * Sepet/sipariş fiyat özeti — checkout `POST /checkout/quote` ve Order snapshot'ının kaynağı.
 *
 * 1. Satır toplamları (PRODUCT/BOX kuruşa, EXTRA tam TL; `skipThisWeek` → BOX+EXTRA 0).
 * 2. Order.kind (karışık sepet önceliği).
 * 3. İndirim: yalnız SUBSCRIPTION ve atlanmamışsa, BOX satırına ilk-kutu (hak varsa) YA DA retention — üst üste binmez;
 *    tutar `rules.discountRounding` ile kuruş/tam TL (ADR-0018).
 * 4. Kargo: abonelik siparişi → 0; aktif abone → 0 (SINGLE'da yalnız `rules.subscriberFreeShipping`); değilse indirim sonrası
 *    ara toplam eşiği karşılıyorsa (`rules.freeShippingRule` ≥ / >) → 0; aksi hâlde zone.fee. Boş sepet → 0.
 * 5. KDV: satır bazlı, indirim sonrası tutardan (gross×r/(100+r)); vatTotal = Σ(yuvarlanmamış) → kuruş.
 * 6. grandTotal = subtotal − discountTotal + shippingFee.
 * `ctx.rules` verilmezse varsayılan kurallar (gte / kurus / true) — mevcut çağrılar aynı sonucu verir.
 */
export function computeQuote(lines: readonly PricingLineInput[], ctx: PricingContext): PricingResult {
  const notes: PricingNote[] = [];
  const rules = resolvePricingRules(ctx.rules);
  const skipped = ctx.skipThisWeek === true;
  const priced = priceLines(lines, ctx.vatRateDefault, skipped ? [OrderLineKind.BOX, OrderLineKind.EXTRA] : []);
  const orderKind = resolveOrderKind(priced, ctx);
  const subtotal = subtotalOf(priced);

  if (priced.length === 0) notes.push({ code: 'EMPTY', message: 'Sepet boş.' });
  if (skipped && priced.some((l) => l.kind !== OrderLineKind.PRODUCT)) {
    notes.push({ code: 'SKIPPED_WEEK', message: 'Bu hafta atlandı — kutu ve ekstralar için ödeme yok.' });
  }

  // İndirim — yalnız abonelik kutusuna (tek seferlik kutuda yok)
  if (orderKind === OrderKind.SUBSCRIPTION && !skipped) {
    for (const line of priced) {
      if (line.kind !== OrderLineKind.BOX) continue;
      const d = resolveBoxDiscount(line.lineTotal, ctx);
      if (d.kind === null) continue;
      line.discount = d.amount;
      notes.push(
        d.kind === 'FIRST_BOXES'
          ? { code: 'FIRST_BOXES_DISCOUNT', message: `İlk kutularda %${d.pct} indirim uygulandı.`, amount: d.amount }
          : { code: 'RETENTION_DISCOUNT', message: `1 kutuluk %${d.pct} indirim (üye kaldığın için).`, amount: d.amount },
      );
    }
  } else if (orderKind === OrderKind.BOX_ONE_TIME && (ctx.firstBoxesLeft > 0 || (ctx.retentionPct ?? 0) > 0) && !skipped) {
    notes.push({ code: 'NO_BOX_DISCOUNT_ONE_TIME', message: 'Tek seferlik kutuda indirim uygulanmaz.' });
  }
  const discountTotal = sumMoney(priced.map((l) => l.discount));
  const subtotalAfterDiscount = roundMoney(subtotal - discountTotal);

  // Kargo
  let shippingFee: Money = 0;
  if (priced.length > 0) {
    const shipping = computeShipping({
      subtotalAfterDiscount,
      zone: ctx.zone,
      hasActiveSubscription: ctx.hasActiveSubscription,
      orderKind,
      rules,
    });
    shippingFee = shipping.fee;
    if (shipping.reason === 'SUBSCRIBER') notes.push({ code: 'FREE_SHIPPING_SUBSCRIBER', message: 'Abonelere kargo dahil.' });
    else if (shipping.reason === 'THRESHOLD') {
      const threshold = formatMoneyTr(ctx.zone.freeThreshold ?? 0);
      notes.push({
        code: 'FREE_SHIPPING_THRESHOLD',
        message: rules.freeShippingRule === 'gt' ? `${threshold} TL üzeri kargo ücretsiz.` : `${threshold} TL ve üzeri kargo ücretsiz.`,
      });
    } else notes.push({ code: 'SHIPPING_FEE', message: `Kargo ücreti ${formatMoneyTr(shippingFee)} TL.`, amount: shippingFee });
  }

  // KDV (indirim sonrası, satır bazlı)
  const vatTotal = applyVat(priced);
  const grandTotal = roundMoney(subtotalAfterDiscount + shippingFee);

  // Peşin kutu tutarı (cycle#1): BOX + EXTRA satırları, indirim düşülmüş
  const prepaidAmount =
    orderKind === OrderKind.SINGLE
      ? null
      : sumMoney(priced.filter((l) => l.kind !== OrderLineKind.PRODUCT).map((l) => l.lineTotal - l.discount));

  return { orderKind, lines: priced, subtotal, discountTotal, shippingFee, vatTotal, grandTotal, prepaidAmount, notes };
}

export interface CycleChargeInput {
  /** Kilit anındaki tier fiyatı. */
  boxPrice: Money;
  /** EXTRA + CART_MERGE öğeleri: birim fiyat × çarpan (tam TL'ye yuvarlanır). */
  extras: readonly { unitPrice: Money; factor: number }[];
  /** Tek seferlik kutu mu (BOX_ONE_TIME: indirim yok, kargo zone kuralı). */
  isOneTime: boolean;
  zone: ZoneShippingRule;
  firstBoxesLeft: number;
  retentionPct: number | null;
  firstBoxPct?: number;
  /** cycle#1: checkout'ta peşin ödenen tutar; cycle#n: 0. */
  prepaidAmount: Money;
  /** Fiyatlama kuralları (ADR-0018; Setting commerce.*); yoksa varsayılan. Burada yalnız discountRounding ve freeShippingRule etkilidir. */
  rules?: Partial<PricingRules>;
}

/**
 * Cycle kilit anı snapshot'ı (state-machines §8 adım 2–3; `cycles:lock-and-charge`):
 *   boxPrice · extrasTotal = Σ roundExtraPrice · discount = ilk-kutu ?: retention (yalnız abonelik; yuvarlama `rules.discountRounding`) ·
 *   shippingFee = abonelik 0 / tek seferlik zone kuralı (`rules.freeShippingRule`) · total = box + extras − discount + shipping · due = total − prepaid.
 * `due <= 0` → tahsilat yok (cycle CHARGED, tutar 0); cycle#1'de due = yalnız DELTA (ekstralar).
 */
export function computeCycleCharge(input: CycleChargeInput): CycleChargeQuote {
  const rules = resolvePricingRules(input.rules);
  const boxPrice = roundMoney(input.boxPrice);
  const extras = extrasTotal(input.extras);
  const discount = input.isOneTime
    ? { amount: 0, kind: null as CycleChargeQuote['discountKind'] }
    : resolveBoxDiscount(boxPrice, { firstBoxesLeft: input.firstBoxesLeft, retentionPct: input.retentionPct, firstBoxPct: input.firstBoxPct, rules });
  const orderKind = input.isOneTime ? OrderKind.BOX_ONE_TIME : OrderKind.SUBSCRIPTION;
  const shippingFee = computeShipping({
    subtotalAfterDiscount: roundMoney(boxPrice + extras - discount.amount),
    zone: input.zone,
    hasActiveSubscription: !input.isOneTime,
    orderKind,
    rules,
  }).fee;
  const total = roundMoney(boxPrice + extras - discount.amount + shippingFee);
  const due = roundMoney(total - input.prepaidAmount);
  return { boxPrice, extrasTotal: extras, discount: discount.amount, shippingFee, total, due, discountKind: discount.kind };
}
