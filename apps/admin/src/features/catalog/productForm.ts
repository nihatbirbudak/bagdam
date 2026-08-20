/**
 * Ürün formu taslağı: varsayılanlar · API detayı → taslak · taslak → gövde · doğrulama (saf fonksiyonlar, test edilir).
 * Doğrulama sunucudakinin (ValidationPipe) hafif kopyasıdır; nihai karar API'de.
 */
import { ProductStatus, StockStatus, type ExtraOption, type ProductStatus as ProductStatusT, type StockStatus as StockStatusT } from '@bagdam/shared';
import type { AdminProductBody, AdminProductDetail } from '../../lib/adminTypes';
import { parseDecimalInput, slugify } from '../../lib/utils';

/** Form alanları metin olarak tutulur (kontrollü input); gövdeye çevrilirken tiplenir. */
export interface ProductDraft {
  slug: string;
  name: string;
  categoryId: string;
  group: string;
  producerId: string;
  metaNote: string;
  /** "129,50" gibi; `toProductBody` sayıya çevirir. */
  price: string;
  vatRate: number;
  unit: string;
  boxAmount: string;
  extraOptions: ExtraOptionDraft[];
  /** null → Setting `commerce.extraAmountOptions` varsayılanı kullanılır. */
  useDefaultExtraOptions: boolean;
  description: string;
  storageText: string;
  allergenText: string;
  freshnessNote: string;
  prefLabel: string;
  /** Satır başına bir seçenek. */
  prefOptionsText: string;
  prefDefault: string;
  isFresh: boolean;
  season: string;
  status: ProductStatusT;
  stockStatus: StockStatusT;
  pairWithBox: boolean;
  pairOrder: string;
  sortOrder: string;
}

export interface ExtraOptionDraft {
  factor: string;
  label: string;
}

export type ProductDraftErrors = Partial<Record<keyof ProductDraft | `extraOptions.${number}.factor` | `extraOptions.${number}.label`, string>>;

/** Sekme → alanlar (hatalı sekmeyi işaretlemek için). */
export const PRODUCT_TABS = [
  { key: 'genel', label: 'Genel', fields: ['name', 'slug', 'categoryId', 'group', 'producerId', 'metaNote', 'status', 'stockStatus', 'sortOrder'] },
  { key: 'fiyat', label: 'Fiyat / KDV', fields: ['price', 'vatRate', 'unit', 'extraOptions'] },
  { key: 'kutu', label: 'Kutu', fields: ['isFresh', 'boxAmount', 'pairWithBox', 'pairOrder', 'season'] },
  { key: 'tercih', label: 'Tercih', fields: ['prefLabel', 'prefOptionsText', 'prefDefault'] },
  { key: 'metinler', label: 'Metinler', fields: ['description', 'storageText', 'allergenText', 'freshnessNote'] },
  { key: 'partiler', label: 'Partiler', fields: [] },
  { key: 'gorseller', label: 'Görseller', fields: [] },
] as const;

export type ProductTabKey = (typeof PRODUCT_TABS)[number]['key'];

/** KDV oranları (gıda %1, %10; genel %20). */
export const VAT_RATE_OPTIONS = [1, 10, 20] as const;

export const UNIT_SUGGESTIONS = ['adet', 'kg', '500 g', '250 g', 'demet', 'kavanoz', 'şişe', 'paket', 'litre'];

export const PRODUCT_GROUP_SUGGESTIONS = ['meyve', 'sebze', 'bakliyat', 'süt ürünleri', 'fırın', 'kiler'];

export function createDefaultProductDraft(): ProductDraft {
  return {
    slug: '',
    name: '',
    categoryId: '',
    group: '',
    producerId: '',
    metaNote: '',
    price: '',
    vatRate: 1,
    unit: '',
    boxAmount: '',
    extraOptions: [],
    useDefaultExtraOptions: true,
    description: '',
    storageText: '',
    allergenText: '',
    freshnessNote: '',
    prefLabel: '',
    prefOptionsText: '',
    prefDefault: '',
    isFresh: false,
    season: '',
    status: ProductStatus.DRAFT,
    stockStatus: StockStatus.IN_STOCK,
    pairWithBox: false,
    pairOrder: '0',
    sortOrder: '0',
  };
}

/** Sayıyı tr-TR form metnine çevirir ("129.5" → "129,50"). */
export function moneyToInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2).replace('.', ',');
}

export function detailToDraft(p: AdminProductDetail): ProductDraft {
  const extras = Array.isArray(p.extraOptions) ? p.extraOptions : null;
  return {
    slug: p.slug ?? '',
    name: p.name ?? '',
    categoryId: p.categoryId ?? p.category?.id ?? '',
    group: p.group ?? '',
    producerId: p.producerId ?? p.producer?.id ?? '',
    metaNote: p.metaNote ?? '',
    price: moneyToInput(p.price),
    vatRate: Number.isFinite(p.vatRate) ? p.vatRate : 1,
    unit: p.unit ?? '',
    boxAmount: p.boxAmount ?? '',
    extraOptions: (extras ?? []).map((o) => ({ factor: String(o.factor).replace('.', ','), label: o.label ?? '' })),
    useDefaultExtraOptions: extras === null,
    description: p.description ?? '',
    storageText: p.storageText ?? '',
    allergenText: p.allergenText ?? '',
    freshnessNote: p.freshnessNote ?? '',
    prefLabel: p.prefLabel ?? '',
    prefOptionsText: (p.prefOptions ?? []).join('\n'),
    prefDefault: p.prefDefault === null || p.prefDefault === undefined ? '' : String(p.prefDefault),
    isFresh: !!p.isFresh,
    season: p.season ?? '',
    status: p.status ?? ProductStatus.DRAFT,
    stockStatus: p.stockStatus ?? StockStatus.IN_STOCK,
    pairWithBox: !!p.pairWithBox,
    pairOrder: String(p.pairOrder ?? 0),
    sortOrder: String(p.sortOrder ?? 0),
  };
}

function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/** Satır başına seçenek; boş satırlar atılır. */
export function parsePrefOptions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

/** API `SLUG_RE` ile aynı: küçük harf/rakam ile başlar; küçük harf, rakam, tire, alt çizgi; 1–80. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** Alan doğrulaması; hatasızsa boş nesne. */
export function validateProductDraft(d: ProductDraft): ProductDraftErrors {
  const e: ProductDraftErrors = {};
  if (!d.name.trim()) e.name = 'Ürün adı zorunlu';
  else if (d.name.trim().length > 120) e.name = 'En fazla 120 karakter';

  if (!d.slug.trim()) e.slug = 'Slug zorunlu';
  else if (!SLUG_RE.test(d.slug.trim())) e.slug = 'Yalnız küçük harf, rakam ve tire; en fazla 80 karakter (ör. zeytinyagi-erken-hasat)';

  if (!d.categoryId) e.categoryId = 'Kategori seçin';

  const price = parseDecimalInput(d.price);
  if (price === null) e.price = 'Fiyat zorunlu (ör. 129,50)';
  else if (price < 0) e.price = 'Fiyat negatif olamaz';
  else if (price > 9_999_999_999) e.price = 'Fiyat çok büyük';

  if (!Number.isInteger(d.vatRate) || d.vatRate < 0 || d.vatRate > 100) e.vatRate = 'KDV oranı 0–100 arası tam sayı';

  if (!d.unit.trim()) e.unit = 'Birim zorunlu (ör. adet, kg, 500 g)';
  else if (d.unit.trim().length > 40) e.unit = 'En fazla 40 karakter';

  if (!d.description.trim()) e.description = 'Açıklama zorunlu';

  if (d.metaNote.trim().length > 80) e.metaNote = 'En fazla 80 karakter';
  if (d.boxAmount.trim().length > 60) e.boxAmount = 'En fazla 60 karakter';
  if (d.allergenText.trim().length > 120) e.allergenText = 'En fazla 120 karakter';
  if (d.freshnessNote.trim().length > 120) e.freshnessNote = 'En fazla 120 karakter';
  if (d.prefLabel.trim().length > 40) e.prefLabel = 'En fazla 40 karakter';
  if (d.season.trim().length > 40) e.season = 'En fazla 40 karakter';
  if (d.group.trim().length > 40) e.group = 'En fazla 40 karakter';

  const prefOptions = parsePrefOptions(d.prefOptionsText);
  if (d.prefLabel.trim() && prefOptions.length === 0) e.prefOptionsText = 'Tercih etiketi varsa en az bir seçenek girin';
  if (!d.prefLabel.trim() && prefOptions.length > 0) e.prefLabel = 'Seçenekler için tercih etiketi girin';
  if (d.prefDefault.trim()) {
    const idx = parseIntInput(d.prefDefault);
    if (idx === null || idx < 0) e.prefDefault = 'Varsayılan seçenek indeksi 0 ya da pozitif tam sayı';
    else if (idx >= prefOptions.length) e.prefDefault = `Seçenek sayısı ${prefOptions.length}; indeks 0–${Math.max(0, prefOptions.length - 1)} olmalı`;
  }

  if (!d.useDefaultExtraOptions) {
    d.extraOptions.forEach((o, i) => {
      const f = parseDecimalInput(o.factor);
      if (f === null || f <= 0) e[`extraOptions.${i}.factor`] = 'Çarpan pozitif sayı olmalı (250 g için 0,25)';
      if (!o.label.trim()) e[`extraOptions.${i}.label`] = 'Etiket zorunlu (ör. "500 g")';
    });
    if (d.extraOptions.length === 0) e.extraOptions = 'En az bir seçenek ekleyin ya da varsayılanı kullanın';
  }

  const pairOrder = parseIntInput(d.pairOrder);
  if (pairOrder === null || pairOrder < 0) e.pairOrder = 'Tam sayı (0 ya da büyük)';
  const sortOrder = parseIntInput(d.sortOrder);
  if (sortOrder === null || sortOrder < 0) e.sortOrder = 'Tam sayı (0 ya da büyük)';

  return e;
}

/** Hangi sekmelerde hata var. */
export function tabsWithErrors(errors: ProductDraftErrors): Set<ProductTabKey> {
  const keys = Object.keys(errors);
  const out = new Set<ProductTabKey>();
  for (const tab of PRODUCT_TABS) {
    const fields: readonly string[] = tab.fields;
    if (keys.some((k) => fields.includes(k) || fields.some((f) => k.startsWith(`${f}.`)))) out.add(tab.key);
  }
  return out;
}

/** Geçerli taslağı API gövdesine çevirir (doğrulamadan sonra çağrılır). */
export function toProductBody(d: ProductDraft): AdminProductBody {
  const prefOptions = parsePrefOptions(d.prefOptionsText);
  const prefDefault = d.prefDefault.trim() ? parseIntInput(d.prefDefault) : null;
  const extraOptions: ExtraOption[] | null = d.useDefaultExtraOptions
    ? null
    : d.extraOptions.map((o) => ({ factor: parseDecimalInput(o.factor) ?? 0, label: o.label.trim() }));
  return {
    slug: d.slug.trim(),
    name: d.name.trim(),
    categoryId: d.categoryId,
    group: emptyToNull(d.group),
    producerId: d.producerId || null,
    metaNote: emptyToNull(d.metaNote),
    price: parseDecimalInput(d.price) ?? 0,
    vatRate: d.vatRate,
    unit: d.unit.trim(),
    boxAmount: emptyToNull(d.boxAmount),
    extraOptions,
    description: d.description.trim(),
    storageText: emptyToNull(d.storageText),
    allergenText: emptyToNull(d.allergenText),
    freshnessNote: emptyToNull(d.freshnessNote),
    prefLabel: emptyToNull(d.prefLabel),
    prefOptions,
    prefDefault: prefOptions.length ? prefDefault : null,
    isFresh: d.isFresh,
    season: emptyToNull(d.season),
    status: d.status,
    stockStatus: d.stockStatus,
    pairWithBox: d.pairWithBox,
    pairOrder: parseIntInput(d.pairOrder) ?? 0,
    sortOrder: parseIntInput(d.sortOrder) ?? 0,
  };
}

/** Ad yazılırken slug'ı türetir (kullanıcı slug'ı elle değiştirmediyse). */
export function suggestSlug(name: string): string {
  return slugify(name).slice(0, 80);
}
