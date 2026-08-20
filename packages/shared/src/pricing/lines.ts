// ── Satır fiyatlama ve KDV ayrıştırma çekirdeği ──────────────────────────────
// computeQuote ve computeDeltaOrder bu çekirdeği paylaşır (döngüsel import olmasın diye ayrı dosya).
import { OrderLineKind } from '../enums';
import type { Money, PricedLine, PricingLineInput } from '../types/pricing';
import { roundExtraPrice, roundMoney, sumMoney, vatFromGrossRaw } from './money';

/** Satır toplamı (indirim öncesi, KDV dahil): PRODUCT/BOX `unitPrice × qty` kuruşa; EXTRA `Math.round(unitPrice × factor)` tam TL (cart.js). */
export function lineTotalOf(line: Pick<PricingLineInput, 'kind' | 'unitPrice' | 'qty'>): Money {
  if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
    throw new RangeError(`lineTotalOf: unitPrice 0 ya da pozitif olmalı (${String(line.unitPrice)})`);
  }
  if (!Number.isFinite(line.qty) || line.qty < 0) {
    throw new RangeError(`lineTotalOf: qty 0 ya da pozitif olmalı (${String(line.qty)})`);
  }
  if (line.kind === OrderLineKind.EXTRA) return roundExtraPrice(line.unitPrice, line.qty);
  return roundMoney(line.unitPrice * line.qty);
}

/** Satır KDV'si (yuvarlanmamış): `(lineTotal − discount) × rate / (100 + rate)`. */
export function lineVatRaw(line: Pick<PricedLine, 'lineTotal' | 'discount' | 'vatRate'>): number {
  return vatFromGrossRaw(line.lineTotal - line.discount, line.vatRate);
}

/**
 * Girdileri fiyatlanmış satırlara çevirir (indirim 0, KDV hesaplanmamış): `vatRate` çözülür, `lineTotal` hesaplanır.
 * `zeroKinds`: toplamı 0 yazılacak çeşitler (atlanan hafta: BOX + EXTRA).
 */
export function priceLines(
  lines: readonly PricingLineInput[],
  vatRateDefault: number,
  zeroKinds: readonly OrderLineKind[] = [],
): PricedLine[] {
  return lines.map((line) => {
    const vatRate = line.vatRate ?? vatRateDefault;
    if (!Number.isFinite(vatRate) || vatRate < 0) throw new RangeError('priceLines: vatRate 0 ya da pozitif olmalı');
    const lineTotal = zeroKinds.includes(line.kind) ? 0 : lineTotalOf(line);
    return { ...line, vatRate, lineTotal, discount: 0, vatAmount: 0 };
  });
}

/**
 * Satır KDV tutarlarını yazar ve toplamı döndürür. Toplam, satırların YUVARLANMAMIŞ KDV'lerinin toplamından
 * kuruşa yuvarlanır (sepet.html: `vat += line*(0.01/1.01)` → tek yuvarlama) — satır `vatAmount`'ları ayrı ayrı
 * yuvarlıdır; Σ vatAmount ile vatTotal arasında en çok birkaç kuruş fark olabilir (fatura toplamı esas: vatTotal).
 */
export function applyVat(lines: PricedLine[]): Money {
  let raw = 0;
  for (const line of lines) {
    const v = lineVatRaw(line);
    line.vatAmount = roundMoney(v);
    raw += v;
  }
  return roundMoney(raw);
}

/** Σ lineTotal (kuruşa yuvarlı). */
export function subtotalOf(lines: readonly Pick<PricedLine, 'lineTotal'>[]): Money {
  return sumMoney(lines.map((l) => l.lineTotal));
}
