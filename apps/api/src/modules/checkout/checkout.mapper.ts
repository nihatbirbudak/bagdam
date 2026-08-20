import {
  OrderLineKind,
  type CheckoutCouponStatus,
  type CheckoutPaymentInfo,
  type CheckoutQuoteResponse,
  type CheckoutQuoteZone,
  type CheckoutRequiredConsent,
  type CheckoutResult,
  type Money,
  type OrderLineBoxMetadata,
  type OrderLineSnapshotInput,
  type OrderStatus,
  type PaymentProvider,
  type PaymentStatus,
  type PricingLineInput,
  type PricingResult,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import type { CouponQuoteOutcome } from '../pricing/pricing.service';
import type { CheckoutProductRecord, LegalDocumentRecord, TierRecord, ZoneRecord } from './checkout.repository';

/** Prisma Decimal(12,2) → number (TL). */
export function money(value: Prisma.Decimal | number): Money {
  return typeof value === 'number' ? value : Number(value.toString());
}

/** Çözülmüş tekil ürün satırı (slug → ürün + adet + tercih). */
export interface ResolvedProductLine {
  product: CheckoutProductRecord;
  qty: number;
  pref: string | null;
}

/** Çözülmüş kutu ekstrası (slug → ürün + çarpan + etiket). */
export interface ResolvedExtra {
  product: CheckoutProductRecord;
  factor: number;
  label: string;
}

/** Çözülmüş kutu taslağı. */
export interface ResolvedBox {
  tier: TierRecord;
  items: string[];
  itemPrefs: Record<string, string>;
  extras: ResolvedExtra[];
  isOneTime: boolean;
  frequencyWeeks: number;
}

/** Tekil ürün satırları → PricingLineInput (PRODUCT; fiyat/KDV katalogdan — P1). */
export function toProductPricingLines(lines: readonly ResolvedProductLine[]): PricingLineInput[] {
  return lines.map((l) => ({
    kind: OrderLineKind.PRODUCT,
    unitPrice: money(l.product.price),
    qty: l.qty,
    vatRate: l.product.vatRate,
    productId: l.product.id,
    pref: l.pref,
    name: l.product.name,
  }));
}

/** Kutu → BOX satırı + EXTRA satırları. */
export function toBoxPricingLines(box: ResolvedBox): PricingLineInput[] {
  return [
    { kind: OrderLineKind.BOX, unitPrice: money(box.tier.price), qty: 1, tierSlug: box.tier.slug, name: box.tier.label },
    ...box.extras.map((e) => ({
      kind: OrderLineKind.EXTRA,
      unitPrice: money(e.product.price),
      qty: e.factor,
      vatRate: e.product.vatRate,
      productId: e.product.id,
      name: e.product.name,
    })),
  ];
}

/**
 * PricedLine[] → Order satır snapshot'ı: PRODUCT (ad/birim/lot/tercih), BOX (tier + kutu içeriği metadata: cycle#1 öğeleri),
 * EXTRA (ürün adı · etiket). Sıra quote ile aynı (fiyatlar quote'tan, yeniden hesap yok).
 */
export function toOrderSnapshotLines(
  quote: PricingResult,
  products: ReadonlyMap<string, ResolvedProductLine>,
  box: ResolvedBox | null,
  boxItems: OrderLineBoxMetadata['items'],
): OrderLineSnapshotInput[] {
  const extrasByProduct = new Map((box?.extras ?? []).map((e) => [e.product.id, e]));
  let productIdx = 0;
  const productLines = [...products.values()];
  return quote.lines.map((l): OrderLineSnapshotInput => {
    if (l.kind === OrderLineKind.BOX && box) {
      return {
        kind: l.kind,
        tierSlug: box.tier.slug,
        name: box.tier.label,
        unit: 'kutu',
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        vatRate: l.vatRate,
        metadata: { items: boxItems } satisfies OrderLineBoxMetadata,
      };
    }
    if (l.kind === OrderLineKind.EXTRA) {
      const extra = l.productId ? extrasByProduct.get(l.productId) : undefined;
      const product = extra?.product;
      return {
        kind: l.kind,
        productId: l.productId ?? null,
        name: product ? (extra.label && extra.label !== product.name ? `${product.name} · ${extra.label}` : product.name) : (l.name ?? 'Ekstra'),
        unit: product?.unit ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        vatRate: l.vatRate,
        lotCode: product?.lots[0]?.lotCode ?? null,
        metadata: extra ? { label: extra.label, source: 'EXTRA' } : null,
      };
    }
    // PRODUCT — quote satırları ürün satırlarıyla aynı sırada kurulur
    const resolved = productLines[productIdx++];
    const product = resolved?.product;
    return {
      kind: OrderLineKind.PRODUCT,
      productId: l.productId ?? product?.id ?? null,
      name: product?.name ?? l.name ?? 'Ürün',
      unit: product?.unit ?? null,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      vatRate: l.vatRate,
      pref: l.pref ?? resolved?.pref ?? null,
      lotCode: product?.lots[0]?.lotCode ?? null,
    };
  });
}

export function toQuoteZone(zone: ZoneRecord): CheckoutQuoteZone {
  return { id: zone.id, slug: zone.slug, name: zone.name, fee: money(zone.fee), freeThreshold: zone.freeThreshold === null ? null : money(zone.freeThreshold) };
}

export function toCouponStatus(outcome: CouponQuoteOutcome | null): CheckoutCouponStatus | null {
  if (!outcome) return null;
  return { code: outcome.code, valid: outcome.valid, message: outcome.message, discount: outcome.discount, reason: outcome.reason };
}

/** LegalKind → checkout Consent türü (KVKK kayıtta; diğer requiresAck belgeler checkout'ta). */
const ACK_KIND_BY_LEGAL: Readonly<Record<string, CheckoutRequiredConsent['kind']>> = {
  PREINFO: 'PREINFO_ACK',
  DISTANCE_SALES: 'CONTRACT_ACK',
  SUBSCRIPTION_CONTRACT: 'SUBSCRIPTION_CONTRACT_ACK',
};

/** Yayındaki requiresAck belgeler → checkout'ta zorunlu onaylar (abonelik sözleşmesi yalnız tekrarlayan abonelikte). */
export function requiredConsentsFrom(docs: readonly LegalDocumentRecord[], isSubscription: boolean): CheckoutRequiredConsent[] {
  const out: CheckoutRequiredConsent[] = [];
  for (const d of docs) {
    const kind = ACK_KIND_BY_LEGAL[d.kind];
    if (!kind) continue;
    if (kind === 'SUBSCRIPTION_CONTRACT_ACK' && !isSubscription) continue;
    out.push({ kind, documentSlug: d.slug, version: d.version, title: d.title });
  }
  return out;
}

export function toQuoteResponse(quote: PricingResult, zone: ZoneRecord, coupon: CouponQuoteOutcome | null, requiredConsents: CheckoutRequiredConsent[]): CheckoutQuoteResponse {
  return { ...quote, zone: toQuoteZone(zone), couponStatus: toCouponStatus(coupon), requiredConsents };
}

export interface CheckoutResultInput {
  orderNo: number;
  orderId: string;
  status: OrderStatus;
  subscriptionId: string | null;
  grandTotal: Money;
  notes: PricingResult['notes'];
  payment: {
    id: string;
    provider: PaymentProvider;
    providerName: string;
    status: PaymentStatus;
    token: string | null;
    checkoutFormContent: string | null;
    redirectUrl: string | null;
    conversationId: string;
  };
}

export function toCheckoutResult(input: CheckoutResultInput): CheckoutResult {
  const payment: CheckoutPaymentInfo = {
    paymentId: input.payment.id,
    provider: input.payment.provider,
    providerName: input.payment.providerName,
    status: input.payment.status,
    token: input.payment.token,
    checkoutFormContent: input.payment.checkoutFormContent,
    redirectUrl: input.payment.redirectUrl,
    conversationId: input.payment.conversationId,
  };
  return {
    orderNo: input.orderNo,
    orderId: input.orderId,
    status: input.status,
    subscriptionId: input.subscriptionId,
    grandTotal: input.grandTotal,
    payment,
    notes: input.notes,
  };
}
