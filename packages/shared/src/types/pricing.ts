// ── Fiyatlama tipleri (packages/shared/src/pricing/** girdi-çıktı sözleşmesi) ──
// Kaynak: docs/BACKEND-PLANI.md §1.1 (Para), §2 "Setting anahtarları (commerce)", §5 F2/F7 (PricingService),
// ADR-0005 (kargo: abone ‖ zone eşik; değer yalnız DeliveryZone), ADR-0006 (DELTA Order), ADR-0007 (ilk-2-kutu, retention),
// ADR-0008 (Order.kind önceliği). Hiçbir tip DB'ye bağlı değildir; api (PricingService) ve admin (önizleme) aynı tipleri kullanır.
//
// Not: `CommerceSettings` (Setting `commerce.*` şekli) `types/settings.ts` içindedir — burada yeniden tanımlanmaz;
// fiyatlama fonksiyonları gerektiğinde `Pick<CommerceSettings, …>` alır. Sepet/localStorage satırı olan
// `CartLineInput {id, qty, pref}` ise `types/order.ts` içindedir; fiyatlama girdisi (aşağıdaki `PricingLineInput`)
// ondan farklıdır: birim fiyat + KDV oranı çözülmüş, çeşidi belli satırdır (api bu dönüşümü katalogdan yapar).
import type { DeliveryDay, OrderKind, OrderLineKind } from '../enums';
import type { IsoDate } from './common';
import type { CommerceSettings } from './settings';

/**
 * Para: TL, KDV DAHİL, 2 ondalık (kuruş). DB'de `Decimal(12,2)`; API DTO'larında number (mapper: `Number(decimal)`).
 * Toplama/çarpma sonrası mutlaka `roundMoney`. (Integer-kuruş yerine number seçildi; tutarlar küçük, çarpan sayısı az.)
 */
export type Money = number;

/** Fiyatlama satırı çeşidi = OrderLine.kind (PRODUCT tekil ürün · BOX kutu/tier · EXTRA kutu üstü ekstra). */
export type PricingLineKind = OrderLineKind;

/**
 * Fiyatlama girdisi — bir sepet/sipariş satırı.
 * - PRODUCT: `unitPrice` ürün fiyatı, `qty` adet (tam sayı).
 * - BOX: `unitPrice` tier fiyatı, `qty` 1, `tierSlug` dolu.
 * - EXTRA: `unitPrice` ürünün birim fiyatı, `qty` = çarpan (`factor`: 250 g için 0.25, 3 demet için 3) — cart.js `subExtraPrice`
 *   ile birebir tam TL'ye yuvarlanır (`roundExtraPrice`).
 * `vatRate` yoksa `PricingContext.vatRateDefault` (Setting `commerce.vatRate`, varsayılan 1).
 */
export interface PricingLineInput {
  kind: PricingLineKind;
  unitPrice: Money;
  qty: number;
  /** KDV oranı (yüzde). Yoksa ctx.vatRateDefault. */
  vatRate?: number;
  /** Product.id ya da slug (snapshot için; hesaba etkisi yok). */
  productId?: string | null;
  /** BOX satırında BoxTier.slug (small | sezon). */
  tierSlug?: string | null;
  /** Tercih metni (yumurta boyu vb.); hesaba etkisi yok. */
  pref?: string | null;
  /** Gösterim adı (opsiyonel; notlar/snapshot için). */
  name?: string;
}

/** Fiyatlanmış satır: girdi + satır toplamı, satıra düşen indirim ve KDV tutarı. */
export interface PricedLine extends PricingLineInput {
  vatRate: number;
  /** `unitPrice × qty` (EXTRA: tam TL) — indirim ÖNCESİ, KDV dahil. Atlanan haftada BOX/EXTRA 0. */
  lineTotal: Money;
  /** Bu satıra düşen indirim (yalnız BOX satırına iner; ilk-2-kutu ya da retention). */
  discount: Money;
  /** KDV tutarı: `(lineTotal − discount) × rate / (100 + rate)` (kuruşa yuvarlı). */
  vatAmount: Money;
}

/** Bölgenin kargo kuralı — TEK sahibi DeliveryZone (`fee`, `freeThreshold`); Setting'de kopyası yok (ADR-0005 [B11]). */
export interface ZoneShippingRule {
  /** Kargo ücreti (TL, KDV dahil). products.js DELIVERY_FEE 49. */
  fee: Money;
  /** Ücretsiz kargo eşiği (indirim sonrası ara toplam ≥ eşik → 0); null = eşik yok. Prototipte 1000. */
  freeThreshold: Money | null;
}

/** Kargo sonucu — `fee` + neden (notlar/önizleme için). */
export type ShippingReason = 'SUBSCRIBER' | 'THRESHOLD' | 'ZONE_FEE' | 'NOTHING_TO_SHIP';
export interface ShippingResult {
  fee: Money;
  reason: ShippingReason;
}

/**
 * Fiyatlama KURALLARI (ADR-0018) — kodda sabit değil, Setting `commerce.*` (admin F5) ile değişir:
 *   freeShippingRule `gte`|`gt` · discountRounding `kurus`|`tl` · subscriberFreeShipping boolean.
 * `CommerceSettings`'in alt kümesidir: çağıran DB'den çözdüğü CommerceSettings'i olduğu gibi verebilir.
 * Verilmeyen alan → `DEFAULT_PRICING_RULES` (= COMMERCE_SETTINGS_DEFAULTS; `pricing/rules.ts`).
 */
export type PricingRules = Pick<CommerceSettings, 'freeShippingRule' | 'discountRounding' | 'subscriberFreeShipping'>;

/**
 * Fiyatlama bağlamı — çağıranın (api PricingService / admin önizleme) DB'den çözüp verdiği gerçekler.
 * "Üye başına 1 kez" kuralları (ilk-2-kutu `User.firstBoxesPromoUsedAt`, retention `User.retentionOfferUsedAt`)
 * ÇAĞIRANIN sorumluluğudur: hak yoksa `firstBoxesLeft: 0` / `retentionPct: null` verilir.
 */
export interface PricingContext {
  /** Teslimat bölgesinin kargo kuralı (adres/varsayılan bölgeden). */
  zone: ZoneShippingRule;
  /** Müşterinin canlı (PENDING|ACTIVE|PAST_DUE|CANCEL_REQUESTED sayılmaz: yalnız ACTIVE/PAST_DUE/CANCEL_REQUESTED — çağıran karar verir) bir aboneliği var mı → kargo 0 (ADR-0005 "abone"). */
  hasActiveSubscription: boolean;
  /**
   * Bu fiyatlamadaki BOX/EXTRA satırları tekrarlayan bir aboneliğe mi ait (kutu.html type "subscription")?
   * true → Order.kind SUBSCRIPTION, ilk-2-kutu/retention indirimi uygulanabilir, kargo 0.
   * false → kutu varsa tek seferlik (BOX_ONE_TIME): indirim yok, kargo zone kuralı.
   */
  isSubscriptionCheckout: boolean;
  /** Kalan indirimli kutu hakkı (`Subscription.discountBoxesLeft`; yeni abonelikte hak varsa Setting `firstBoxDiscount.boxes`, yoksa 0). */
  firstBoxesLeft: number;
  /** Retention indirimi (`Subscription.nextBoxDiscountPct`); yoksa null. İlk-2-kutu uygulanmışsa devreye girmez (üst üste binmez). */
  retentionPct: number | null;
  /** Varsayılan KDV oranı (Setting `commerce.vatRate`, 1). */
  vatRateDefault: number;
  /** İlk kutular indirim yüzdesi (Setting `commerce.firstBoxDiscount.pct`); yoksa 50. */
  firstBoxPct?: number;
  /** cart.js `sub.skipThisWeek`: bu hafta atlandı → BOX ve EXTRA satırları 0 TL, indirim uygulanmaz (atlanan hafta tahsil edilmez, ADR-0007). */
  skipThisWeek?: boolean;
  /**
   * Fiyatlama kuralları (ADR-0018): Setting `commerce.{freeShippingRule,discountRounding,subscriberFreeShipping}`.
   * Kısmi verilebilir; eksik alan varsayılan (`DEFAULT_PRICING_RULES`). Verilmezse tümü varsayılan (geriye dönük uyumlu).
   */
  rules?: Partial<PricingRules>;
}

/** Fiyatlama notu — makine kodu + Türkçe açıklama (+ varsa tutar). UI doğrudan `message`'ı basabilir. */
export type PricingNoteCode =
  | 'EMPTY'
  | 'SKIPPED_WEEK'
  | 'FIRST_BOXES_DISCOUNT'
  | 'RETENTION_DISCOUNT'
  | 'FREE_SHIPPING_SUBSCRIBER'
  | 'FREE_SHIPPING_THRESHOLD'
  | 'SHIPPING_FEE'
  | 'DELTA_NO_SHIPPING'
  | 'NO_BOX_DISCOUNT_ONE_TIME';
export interface PricingNote {
  code: PricingNoteCode;
  message: string;
  amount?: Money;
}

/**
 * Fiyatlama sonucu — Order.{subtotal,discountTotal,shippingFee,vatTotal,grandTotal} ile aynı alanlar (hepsi KDV dahil TL):
 *   subtotal = Σ lineTotal · discountTotal = Σ line.discount · grandTotal = subtotal − discountTotal + shippingFee ·
 *   vatTotal = Σ satır KDV'si (indirim sonrası; kargo KDV'ye dahil DEĞİL — ayrı karar, bkz. pricing/index.ts notu).
 */
export interface PricingResult {
  orderKind: OrderKind;
  lines: PricedLine[];
  subtotal: Money;
  discountTotal: Money;
  shippingFee: Money;
  vatTotal: Money;
  grandTotal: Money;
  /** Kutu siparişlerinde (SUBSCRIPTION | BOX_ONE_TIME) checkout'ta peşin ödenen kutu kısmı: Σ(BOX+EXTRA lineTotal − discount); SINGLE'da null. */
  prepaidAmount: Money | null;
  notes: PricingNote[];
}

/** Kesim kuralı — Setting `commerce.cutoff {daysBefore:1, time:"12:00"}` (ADR-0005: teslimattan 1 gün önce 12:00). */
export interface CutoffRule {
  daysBefore: number;
  /** 'HH:mm' (24 saat), TZ `Europe/Istanbul`. */
  time: string;
}

/** Teslimat tarihi adayı — `nextDeliveryDates` çıktısı; `delivery-dates:generate` ve bootstrap `deliveryDates` bunu kullanır. */
export interface DeliveryDateSlot {
  day: DeliveryDay;
  /** Takvim günü (TZ'ye göre) `YYYY-MM-DD`. */
  date: IsoDate;
  /** Kesim anı (UTC instant) = `date − daysBefore` günü `time` (TZ). */
  cutoffAt: Date;
  /** `cutoffAt <= from` → kesim geçti (bu hafta için kilitli; teslimat günü dahil). */
  locked: boolean;
}

/** `nextDeliveryDates` / `lockedDeliveryDay` seçenekleri. */
export interface DeliveryDateOptions {
  /** IANA saat dilimi; varsayılan `Europe/Istanbul`. */
  tz?: string;
  /** Kesim kuralı; varsayılan `{daysBefore:1, time:'12:00'}`. */
  rule?: CutoffRule;
  /** Kilitli (kesimi geçmiş) tarihler de listeye girsin mi; varsayılan false. */
  includeLocked?: boolean;
}

/** Cycle kilit anı snapshot'ı (state-machines §8 adım 2–3) — `computeCycleCharge` çıktısı. */
export interface CycleChargeQuote {
  boxPrice: Money;
  extrasTotal: Money;
  discount: Money;
  shippingFee: Money;
  /** boxPrice + extrasTotal − discount + shippingFee. */
  total: Money;
  /** total − prepaidAmount (cycle#1: yalnız DELTA; cycle#n: tümü); ≤ 0 → tahsilat yok (CHARGED, tutar 0). */
  due: Money;
  discountKind: 'FIRST_BOXES' | 'RETENTION' | null;
}
