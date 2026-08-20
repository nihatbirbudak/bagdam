import type { BootstrapPayload, BootstrapProduct, HomeFeaturedItem, SubTier } from '@bagdam/shared';

/**
 * index.hbs "öne çıkanlar" ızgarası — SiteContent `home.featured` [{type,ref,order}] (BACKEND-PLANI [B7])
 * + bootstrap products/tiers → iki markup dalı: partials/featured-product.hbs / partials/featured-tier.hbs.
 *
 * Metin alanları burada HTML'e hazır hale getirilir (escapeHtml) ve partial'da `{{{ }}}` ile basılır;
 * gerekçe: Handlebars'ın varsayılan kaçışı `'` → `&#x27;` üretir ("10'lu Sezon Kutusu", "6'lı") ve
 * website/index.html ile byte paritesi (ADR-0003) bozulur. Değerler DB'den (admin) gelir; öznitelikler
 * çift tırnaklı olduğundan & < > " kaçışı yeterlidir.
 */

/** partials/featured-product.hbs bağlamı — tüm alanlar kaçışlanmış metin. */
export interface FeaturedProductView {
  id: string;
  name: string;
  meta: string;
  /** "480" — website/index.html ham tam sayı basar (binlik ayıracı yok; cart.js money() ile aynı DEĞİL). */
  price: string;
  unit: string;
  img: string;
}

/** partials/featured-tier.hbs bağlamı. */
export interface FeaturedTierView {
  id: string;
  label: string;
  /** "9–10 ürün · haftalık" — tier.note'un ilk parçası + " · haftalık" (website/index.html). */
  meta: string;
  price: string;
  img: string;
}

/** `{{#each featured}}{{#if product}}…{{else}}…{{/if}}{{/each}}` için ayrık birleşim. */
export type FeaturedView =
  | { product: FeaturedProductView; tier?: undefined }
  | { tier: FeaturedTierView; product?: undefined };

/**
 * Yedek sıra — F5'ten itibaren WebController SiteContent `home.featured` (`{items:[{type,ref,order}]}`,
 * content-view.ts resolveFeaturedItems) okur; anahtar yoksa/boşsa/bozuksa website/index.html satır 180-267'deki
 * bu sıra kullanılır (7 ürün + 1 tier). Seed değeri bu sabitle aynıdır (database/seeds/content/site-content.json).
 */
export const DEFAULT_FEATURED: readonly HomeFeaturedItem[] = [
  { type: 'product', ref: 'zeytinyagi', order: 1 },
  { type: 'product', ref: 'beyazpeynir', order: 2 },
  { type: 'product', ref: 'ekmek', order: 3 },
  { type: 'tier', ref: 'sezon', order: 4 },
  { type: 'product', ref: 'zeytin', order: 5 },
  { type: 'product', ref: 'yogurt', order: 6 },
  { type: 'product', ref: 'tereyagi', order: 7 },
  { type: 'product', ref: 'salca', order: 8 },
];

/** Metin düğümü ve çift tırnaklı öznitelik için asgari HTML kaçışı (`'` bilerek kaçışlanmaz — parite). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Kart fiyatı: tam sayı → ham basamaklar ("1099", website/index.html ile birebir);
 * kuruşlu fiyat → tr-TR iki ondalık ("480,50"). Binlik ayıracı yok (statik sayfa da koymuyor).
 */
export function formatPrice(amount: number): string {
  if (Number.isInteger(amount)) return String(amount);
  return amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** "9–10 ürün · kalabalık hane, …" → "9–10 ürün · haftalık" (website/index.html tier kartı metası). */
export function tierCardMeta(tier: SubTier): string {
  const head = tier.note ? tier.note.split(' · ')[0].trim() : '';
  return `${head || `${tier.count} ürün`} · haftalık`;
}

function toProductView(p: BootstrapProduct): FeaturedProductView {
  return {
    id: escapeHtml(p.id),
    name: escapeHtml(p.name),
    meta: escapeHtml(p.meta),
    price: formatPrice(p.price),
    unit: escapeHtml(p.unit),
    img: escapeHtml(p.img),
  };
}

function toTierView(t: SubTier): FeaturedTierView {
  return {
    id: escapeHtml(t.id),
    label: escapeHtml(t.label),
    meta: escapeHtml(tierCardMeta(t)),
    price: formatPrice(t.price),
    img: escapeHtml(t.img),
  };
}

/**
 * `home.featured` öğelerini `order`a göre sıralar, bootstrap products/tiers ile eşler ve kart bağlamlarını üretir.
 * Bootstrap'ta olmayan ref (SOLD_OUT/HIDDEN'a düşmüş ürün, pasif tier) atlanır ve `warn` ile bildirilir:
 * sayfa yanlış kartla değil, bir eksik kartla çıkar.
 */
export function buildFeaturedViews(
  items: readonly HomeFeaturedItem[],
  payload: Pick<BootstrapPayload, 'products' | 'tiers'>,
  warn?: (message: string) => void,
): FeaturedView[] {
  const products = new Map(payload.products.map((p) => [p.id, p] as const));
  const tiers = new Map(payload.tiers.map((t) => [t.id, t] as const));
  const views: FeaturedView[] = [];
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    if (item.type === 'product') {
      const p = products.get(item.ref);
      if (p) views.push({ product: toProductView(p) });
      else warn?.(`home.featured: ürün bootstrap'ta yok, atlandı: ${item.ref}`);
    } else if (item.type === 'tier') {
      const t = tiers.get(item.ref);
      if (t) views.push({ tier: toTierView(t) });
      else warn?.(`home.featured: tier bootstrap'ta yok, atlandı: ${item.ref}`);
    } else {
      warn?.(`home.featured: bilinmeyen tür, atlandı: ${String((item as { type: unknown }).type)}`);
    }
  }
  return views;
}
