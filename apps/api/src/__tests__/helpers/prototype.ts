// website/ prototipinin veri sabitleri — snapshot testinin DOĞRULUK KAYNAĞI:
// products.js (PRODUCTS, SUB_TIERS, FREQ_OPTIONS, DELIVERY_DAYS, DELIVERY_FEE) vm ile çalıştırılır;
// kutu.html pairIds ve urunler.html RECOMMENDED_TIER regex ile okunur (database/seeds/convert-products-js.ts ile aynı yöntem).
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as vm from 'vm';
import type { BootstrapProduct, DeliveryDayOption, FreqOption, SubTier } from '@bagdam/shared';
import { REPO_ROOT } from './env';

export const PRODUCTS_JS = resolve(REPO_ROOT, 'website', 'assets', 'products.js');
export const KUTU_HTML = resolve(REPO_ROOT, 'website', 'kutu.html');
export const URUNLER_HTML = resolve(REPO_ROOT, 'website', 'urunler.html');

const CONST_NAMES = ['PRODUCTS', 'SUB_TIERS', 'FREQ_OPTIONS', 'DELIVERY_DAYS', 'DELIVERY_FEE'] as const;

export interface ProductsJsData {
  PRODUCTS: BootstrapProduct[];
  SUB_TIERS: SubTier[];
  FREQ_OPTIONS: FreqOption[];
  DELIVERY_DAYS: DeliveryDayOption[];
  DELIVERY_FEE: number;
}

export interface PrototypeData extends ProductsJsData {
  /** kutu.html `const pairIds = [...]`. */
  pairIds: string[];
  /** urunler.html `const RECOMMENDED_TIER = "..."`. */
  recommendedTier: string;
}

/** products.js'i boş bir vm bağlamında çalıştırır, üst düzey const'ları JSON round-trip ile ana bağlama alır. */
export function loadProductsJs(): ProductsJsData {
  const src = readFileSync(PRODUCTS_JS, 'utf8');
  const tail =
    '\n;({' + CONST_NAMES.map((n) => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(', ') + '})';
  const out = vm.runInNewContext(src + tail, {}, { filename: PRODUCTS_JS, timeout: 5000 }) as Record<string, unknown>;
  const data = JSON.parse(JSON.stringify(out ?? {})) as Record<string, unknown>;
  for (const name of CONST_NAMES) {
    if (data[name] === undefined) throw new Error(`${PRODUCTS_JS}: ${name} tanımlı değil`);
  }
  return data as unknown as ProductsJsData;
}

export function loadPairIds(): string[] {
  const html = readFileSync(KUTU_HTML, 'utf8');
  const m = /const\s+pairIds\s*=\s*(\[[^\]]*\])/.exec(html);
  if (!m?.[1]) throw new Error(`${KUTU_HTML}: pairIds bulunamadı`);
  const ids = vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 1000 }) as unknown;
  const copy = JSON.parse(JSON.stringify(ids)) as unknown;
  if (!Array.isArray(copy) || !copy.every((x) => typeof x === 'string')) throw new Error('kutu.html pairIds dizi değil');
  return copy as string[];
}

export function loadRecommendedTier(): string {
  const html = readFileSync(URUNLER_HTML, 'utf8');
  const m = /const\s+RECOMMENDED_TIER\s*=\s*"([^"]+)"/.exec(html);
  if (!m?.[1]) throw new Error(`${URUNLER_HTML}: RECOMMENDED_TIER bulunamadı`);
  return m[1];
}

export function loadPrototype(): PrototypeData {
  return { ...loadProductsJs(), pairIds: loadPairIds(), recommendedTier: loadRecommendedTier() };
}
