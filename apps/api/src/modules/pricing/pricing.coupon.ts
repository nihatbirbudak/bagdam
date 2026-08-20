import {
  applyVat,
  computeShipping,
  formatMoneyTr,
  OrderLineKind,
  roundMoney,
  sumMoney,
  type CouponScope,
  type Money,
  type PricedLine,
  type PricingContext,
  type PricingNote,
  type PricingNoteCode,
  type PricingResult,
} from '@bagdam/shared';

/** Kupon kapsamına giren satırlar: ALL → hepsi · SINGLE → PRODUCT · BOX → BOX + EXTRA. */
export function isCouponEligibleLine(line: Pick<PricedLine, 'kind'>, scope: CouponScope): boolean {
  if (scope === 'SINGLE') return line.kind === OrderLineKind.PRODUCT;
  if (scope === 'BOX') return line.kind === OrderLineKind.BOX || line.kind === OrderLineKind.EXTRA;
  return true;
}

/** Kapsama göre indirime esas tutarlar (kutu indirimi düşülmüş satır toplamları) — CouponsService.validate girdisi. */
export function couponEligibleAmounts(lines: readonly PricedLine[]): { all: Money; single: Money; box: Money } {
  const net = (l: PricedLine): Money => roundMoney(l.lineTotal - l.discount);
  return {
    all: sumMoney(lines.map(net)),
    single: sumMoney(lines.filter((l) => l.kind === OrderLineKind.PRODUCT).map(net)),
    box: sumMoney(lines.filter((l) => l.kind !== OrderLineKind.PRODUCT).map(net)),
  };
}

const SHIPPING_NOTE_CODES: ReadonlySet<PricingNoteCode> = new Set<PricingNoteCode>(['FREE_SHIPPING_SUBSCRIBER', 'FREE_SHIPPING_THRESHOLD', 'SHIPPING_FEE']);

/**
 * Kupon indirimini quote'a uygular (SAF — shared computeQuote çıktısı üzerine, kurallar ADR-0018):
 *  1. `amount` kapsamdaki satırlara kalan tutarlarına (lineTotal − discount) orantılı dağıtılır (kuruşa; artık son satıra) —
 *     satır `discount` alanına eklenir (KDV indirim sonrası tutardan hesaplanır).
 *  2. discountTotal/subtotalAfterDiscount yeniden; kargo indirim SONRASI ara toplamla yeniden çözülür (eşik kuralı — kupon eşiği
 *     aşağı çekebilir; abonelik siparişinde yine 0).
 *  3. vatTotal satır bazlı (applyVat); grandTotal = subtotal − discountTotal + shippingFee.
 *  4. `prepaidAmount` (cycle#1 peşin) KUPONSUZ değerde kalır: abonelik motoru kesimde `total − prepaid` hesaplar ve kuponu bilmez;
 *     kupon yalnız checkout Order'ına yansır (Order.discountTotal/grandTotal). Kargo zaten prepaid dışındadır (F8 KARAR).
 * `amount` kapsamdaki tutardan büyükse kapsamla sınırlanır; uygulanan gerçek tutar döner.
 */
export function applyCouponToQuote(
  base: PricingResult,
  scope: CouponScope,
  amount: Money,
  ctx: Pick<PricingContext, 'zone' | 'hasActiveSubscription' | 'rules'>,
): { quote: PricingResult; applied: Money } {
  const lines: PricedLine[] = base.lines.map((l) => ({ ...l }));
  const eligible = lines.filter((l) => isCouponEligibleLine(l, scope) && roundMoney(l.lineTotal - l.discount) > 0);
  const capacity = sumMoney(eligible.map((l) => l.lineTotal - l.discount));
  const wanted = roundMoney(Math.min(Math.max(0, amount), capacity));
  if (eligible.length === 0 || !(wanted > 0)) return { quote: base, applied: 0 };

  // Orantılı dağıtım (kuruş); artık son uygun satıra
  let distributed = 0;
  eligible.forEach((line, idx) => {
    const remaining = roundMoney(line.lineTotal - line.discount);
    let share = idx === eligible.length - 1 ? roundMoney(wanted - distributed) : roundMoney((wanted * remaining) / capacity);
    if (share > remaining) share = remaining;
    if (share < 0) share = 0;
    line.discount = roundMoney(line.discount + share);
    distributed = roundMoney(distributed + share);
  });

  const subtotal = base.subtotal;
  const discountTotal = sumMoney(lines.map((l) => l.discount));
  const subtotalAfterDiscount = roundMoney(subtotal - discountTotal);
  const notes: PricingNote[] = base.notes.filter((n) => !SHIPPING_NOTE_CODES.has(n.code));
  let shippingFee: Money = 0;
  if (lines.length > 0) {
    const shipping = computeShipping({
      subtotalAfterDiscount,
      zone: ctx.zone,
      hasActiveSubscription: ctx.hasActiveSubscription,
      orderKind: base.orderKind,
      rules: ctx.rules,
    });
    shippingFee = shipping.fee;
    if (shipping.reason === 'SUBSCRIBER') notes.push({ code: 'FREE_SHIPPING_SUBSCRIBER', message: 'Abonelere kargo dahil.' });
    else if (shipping.reason === 'THRESHOLD') {
      const threshold = formatMoneyTr(ctx.zone.freeThreshold ?? 0);
      notes.push({
        code: 'FREE_SHIPPING_THRESHOLD',
        message: ctx.rules?.freeShippingRule === 'gt' ? `${threshold} TL üzeri kargo ücretsiz.` : `${threshold} TL ve üzeri kargo ücretsiz.`,
      });
    } else notes.push({ code: 'SHIPPING_FEE', message: `Kargo ücreti ${formatMoneyTr(shippingFee)} TL.`, amount: shippingFee });
  }
  const vatTotal = applyVat(lines);
  const grandTotal = roundMoney(subtotalAfterDiscount + shippingFee);
  return {
    quote: { ...base, lines, discountTotal, shippingFee, vatTotal, grandTotal, prepaidAmount: base.prepaidAmount, notes },
    applied: distributed,
  };
}
