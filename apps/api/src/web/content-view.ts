import type { HomeFeaturedItem } from '@bagdam/shared';
import { escapeContentValue, normalizeContentSchema, toSiteContentTree } from '../modules/content/site-content.schema';
import { escapeHtml } from './featured';

/**
 * F5 — şablon (hbs) bağlamı üreticileri: SiteContent ağacı (`site`), yasal belgeler (`legal` / `legalDocs`),
 * günlük yazıları (`posts`), kategori sekmeleri (`categories`, `panelNotes`).
 *
 * Kaçış kuralı (ADR-0003 piksel parite, web/featured.ts ile aynı): metinler sunucu tarafında escapeHtml (& < > " —
 * `'` kaçışlanmaz) ile HTML'e hazırlanır ve şablonda {{{ }}} ile basılır; Handlebars'ın varsayılan kaçışı ' → &#x27;
 * üretip website/*.html ile byte paritesini bozar. `richtext` alanları ve Post/LegalDocument gövdeleri HTML'dir, ham basılır.
 *
 * Kaçış/ağaç kuralları TEK yerde (`modules/content/site-content.schema.ts`: normalizeContentSchema + escapeContentValue +
 * toSiteContentTree); burası yalnız şablon bağlamına şekil verir.
 */

// ── SiteContent ağacı ──────────────────────────────────────────────────────────

/** SiteContent satırının şablon için gereken kısmı (reader / ContentService ortak şekli). */
export interface SiteContentRowLike {
  key: string;
  schema: unknown;
  value: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Tek bloğun şablon değeri: şemaya göre richtext ham, diğer metinler kaçışlı (şema yoksa/bozuksa her metin kaçışlı).
 * Şema normalize edilir (registry ContentSchema ya da DB'deki eski F3 biçimi) — kural site-content.schema'da.
 */
export function escapeSiteContentValue(schema: unknown, value: unknown): unknown {
  const normalized = normalizeContentSchema(schema);
  return escapeContentValue(normalized.fields.length > 0 ? normalized : null, value);
}

/**
 * `[{key:'home.hero', …}, {key:'promoBar', …}]` → `{ home: { hero: {...} }, promoBar: {...} }` — şablon
 * `{{{site.home.hero.title}}}` yazabilsin. Değerler kaçışlanmış (yukarıdaki kural).
 */
export function buildSiteTree(rows: readonly SiteContentRowLike[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const row of rows) flat[row.key] = escapeSiteContentValue(row.schema, row.value);
  return toSiteContentTree(flat);
}

/** `home.featured` değeri (`{items:[…]}` ya da düz dizi) → geçerli öğeler; boş/yoksa null (çağıran DEFAULT_FEATURED'a düşer). */
export function resolveFeaturedItems(raw: unknown): HomeFeaturedItem[] | null {
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.items) ? raw.items : null;
  if (!list) return null;
  const items: HomeFeaturedItem[] = [];
  for (const it of list) {
    if (!isPlainObject(it)) continue;
    const type = it.type;
    const ref = it.ref;
    const order = typeof it.order === 'number' ? it.order : Number(it.order);
    if ((type === 'product' || type === 'tier') && typeof ref === 'string' && ref.length > 0 && Number.isFinite(order)) {
      items.push({ type, ref, order });
    }
  }
  return items.length > 0 ? items : null;
}

// ── Yasal belgeler (politikalar.hbs) ───────────────────────────────────────────

/** Reader / ContentService'ten gelen yayındaki belge (gövde dahil). */
export interface LegalDocLike {
  slug: string;
  kind: string;
  title: string;
  version: number;
  leadHtml: string | null;
  bodyHtml: string;
  effectiveFrom: Date;
  requiresAck: boolean;
  showInNav: boolean;
  sortOrder: number;
}

/** `{{#each legal}}` nav öğesi (ContentService.getLegalNav() LegalNavItem ile aynı alanlar + kaçışlı title). */
export interface LegalNavView {
  slug: string;
  title: string;
  kind: string;
  version: number;
  sortOrder: number;
  requiresAck: boolean;
}

/** `{{#each legalDocs}}` makale bağlamı — nav'sız belgeler de basılır (hidden; sayfa JS'i hash ile gösterir, [B16]). */
export interface LegalArticleView extends LegalNavView {
  showInNav: boolean;
  /** "18 AĞUSTOS 2026" — effectiveFrom, Europe/Istanbul, tr-TR büyük harf (politikalar.html "SON GÜNCELLEME" satırı). */
  updatedLabel: string;
  leadHtml: string;
  bodyHtml: string;
}

const TR_LONG_DATE = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
const TR_SHORT_DATE = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });

/** "18 Ağustos 2026" → "18 AĞUSTOS 2026" (tr-TR büyük harf: i → İ). */
export function legalUpdatedLabel(effectiveFrom: Date): string {
  return TR_LONG_DATE.format(effectiveFrom).toLocaleUpperCase('tr-TR');
}

/** "16.08.2026" (gunluk.html meta tarihi). */
export function postDateLabel(date: Date): string {
  return TR_SHORT_DATE.format(date);
}

function toLegalNavView(d: LegalDocLike): LegalNavView {
  return {
    slug: escapeHtml(d.slug),
    title: escapeHtml(d.title),
    kind: d.kind,
    version: d.version,
    sortOrder: d.sortOrder,
    requiresAck: d.requiresAck,
  };
}

/** Nav: isCurrent && showInNav, sortOrder sırası (8 politika). */
export function buildLegalNav(docs: readonly LegalDocLike[]): LegalNavView[] {
  return docs
    .filter((d) => d.showInNav)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toLegalNavView);
}

/** Makaleler: nav'dakiler önce (sortOrder), ardından nav'sızlar — ilk makale görünür, diğerleri hidden (sayfa JS'i). */
export function buildLegalArticles(docs: readonly LegalDocLike[]): LegalArticleView[] {
  return [...docs]
    .sort((a, b) => Number(b.showInNav) - Number(a.showInNav) || a.sortOrder - b.sortOrder)
    .map((d) => ({
      ...toLegalNavView(d),
      showInNav: d.showInNav,
      updatedLabel: escapeHtml(legalUpdatedLabel(d.effectiveFrom)),
      leadHtml: d.leadHtml ?? '',
      bodyHtml: d.bodyHtml,
    }));
}

// ── Checkout (sepet.hbs) — F8: `window.__BAGDAM_CHECKOUT__` ───────────────────

/** DeliveryService.listPublicZones() öğesi (DeliveryZonePublic ile aynı alanlar). */
export interface DeliveryZoneLike {
  id: string;
  slug: string;
  name: string;
  fee: number;
  freeThreshold: number | null;
}

/** Checkout'ta açık onay gerektiren belge (ADR-0003 istisna 3) — ham metin (JSON'a gider, sayfa JS'i kaçışlar). */
export interface CheckoutLegalView {
  slug: string;
  kind: string;
  title: string;
  version: number;
}

export interface CheckoutBootstrapView {
  legal: CheckoutLegalView[];
  zones: DeliveryZoneLike[];
}

/**
 * sepet.hbs `__BAGDAM_CHECKOUT__`: requiresAck belgeler (PREINFO / DISTANCE_SALES / SUBSCRIPTION_CONTRACT / KVKK — sayfa JS'i
 * checkout'ta geçerli türleri ve abonelik koşulunu seçer; sortOrder sırası) + aktif teslimat bölgeleri (ilçe select).
 */
export function buildCheckoutBootstrap(docs: readonly LegalDocLike[], zones: readonly DeliveryZoneLike[]): CheckoutBootstrapView {
  return {
    legal: docs
      .filter((d) => d.requiresAck)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((d) => ({ slug: d.slug, kind: d.kind, title: d.title, version: d.version })),
    zones: zones.map((z) => ({ id: z.id, slug: z.slug, name: z.name, fee: z.fee, freeThreshold: z.freeThreshold })),
  };
}

// ── Günlük yazıları (gunluk.hbs + index.hbs "son yazılar") ─────────────────────

export interface PostLike {
  slug: string;
  kind: string;
  readMinutes: number;
  titleHtml: string;
  bodyHtml: string;
  publishedAt: Date | null;
  /** Kapak: site-göreli yol (`assets/images/…` | `uploads/…`) ve alt metni; yoksa null. */
  coverPath: string | null;
  coverAlt: string | null;
}

/** `{{#each posts}}` bağlamı (partials/journal-post.hbs + index.hbs kartları). */
export interface PostView {
  slug: string;
  /** "Söyleşi · 5 dk" (index.hbs journal-tag). */
  tag: string;
  /** "SÖYLEŞİ · 5 DK · 16.08.2026" (gunluk.hbs journal-post-meta). */
  meta: string;
  /** Ham HTML başlık (`<em>` içerebilir). */
  titleHtml: string;
  /** Etiketsiz, kaçışlı başlık (index.hbs kart h3'ü). */
  titleText: string;
  /** Ham HTML gövde. */
  bodyHtml: string;
  coverPath: string;
  coverAlt: string;
  hasCover: boolean;
}

/** HTML etiketlerini atar (başlığın düz metin hali). */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

export function toPostView(p: PostLike): PostView {
  const tag = `${p.kind} · ${p.readMinutes} dk`;
  const date = p.publishedAt ? postDateLabel(p.publishedAt) : '';
  const meta = date ? `${tag.toLocaleUpperCase('tr-TR')} · ${date}` : tag.toLocaleUpperCase('tr-TR');
  return {
    slug: escapeHtml(p.slug),
    tag: escapeHtml(tag),
    meta: escapeHtml(meta),
    titleHtml: p.titleHtml,
    titleText: escapeHtml(stripTags(p.titleHtml)),
    bodyHtml: p.bodyHtml,
    coverPath: escapeHtml(p.coverPath ?? ''),
    coverAlt: escapeHtml(p.coverAlt ?? ''),
    hasCover: Boolean(p.coverPath),
  };
}

// ── Kategori sekmeleri (index.hbs vitrin/mobil sekmeler, urunler.hbs sekmeler + panel notları) ─────

export interface CategoryLike {
  slug: string;
  label: string;
  panelNote: string | null;
}

/** `{{#each categories}}` — ikon yolu sözleşmesi `assets/icons/<slug>.png` (website/index.html ile aynı). */
export interface CategoryTabView {
  slug: string;
  label: string;
  href: string;
  icon: string;
}

export function buildCategoryTabs(categories: readonly CategoryLike[]): CategoryTabView[] {
  return categories.map((c) => ({
    slug: escapeHtml(c.slug),
    label: escapeHtml(c.label),
    href: escapeHtml(`urunler.html?tab=${c.slug}`),
    icon: escapeHtml(`assets/icons/${c.slug}.png`),
  }));
}

/** urunler.hbs `.prod-panel-note` — slug → kaçışlı not (Category.panelNote TEK SAHİP [B11]; yoksa ''). */
export function buildPanelNotes(categories: readonly CategoryLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of categories) out[c.slug] = escapeHtml(c.panelNote ?? '');
  return out;
}
