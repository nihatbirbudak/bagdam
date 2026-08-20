import type { ContentField, ContentFieldType, ContentSchema } from '@bagdam/shared';

/**
 * SiteContent KAYNAK LİSTESİ (F5, BACKEND-PLANI §2 "SiteContent anahtarları") — anahtar, etiket, sayfa ve şema.
 *
 * Kurallar (A/C/D sözleşmesi):
 * - Şema burada yaşar (DB'deki `schema` kolonu bunun kopyasıdır; PUT'ta registry şeması DB'ye de yazılır).
 *   Alan adlarında anlaşmazlık olursa bu dosya kaynaktır; seed (C) ve admin formu (D) aynı adları kullanır.
 * - Değerler NESNEDİR: liste blokları `{ items: [...] }` (promoBar/footer/urunler.trust F3 seed'iyle birebir —
 *   var olan adlar benimsendi). Şablonda `{{{site.home.hero.title}}}` → ContentService.getSiteContentForViews()
 *   (noktalı anahtarlar ağaca açılır; richtext dışındaki metinler escapeHtml — ' kaçışlanmaz, piksel parite).
 * - `richtext` = HTML olduğu gibi basılır (br/em/b/a serbest); `text`/`textarea` düz metin; `image` site-göreli yol
 *   (`assets/images/x.jpg`) ya da `/uploads/...`; `url` mutlak/göreli bağlantı (`urunler.html`, `tel:`, `https://`).
 * - Metinler website/*.html'den; seed (C) gerçek değerleri doldurur, burada değer YOK.
 */
export interface SiteContentRegistryEntry {
  key: string;
  label: string;
  /** Admin menü gruplaması: global (promo/footer) · index · urunler · kutu · nasil-seciyoruz · toptan · gunluk. */
  page: SiteContentPage;
  schema: ContentSchema;
}

export const SITE_CONTENT_PAGES = ['global', 'index', 'urunler', 'kutu', 'nasil-seciyoruz', 'toptan', 'gunluk', 'mail'] as const;
export type SiteContentPage = (typeof SITE_CONTENT_PAGES)[number];

/** Alan tipleri — HTML olarak ham basılanlar (escape YOK). */
export const HTML_CONTENT_FIELD_TYPES: ReadonlySet<ContentFieldType> = new Set<ContentFieldType>(['richtext']);

// ── Kısa kurucular ─────────────────────────────────────────────────────────────
type Extra = Partial<Omit<ContentField, 'name' | 'label' | 'type'>>;
const field = (name: string, label: string, type: ContentFieldType, extra: Extra = {}): ContentField => ({
  name,
  label,
  type,
  ...extra,
});
const text = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'text', extra);
const textarea = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'textarea', extra);
const richtext = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'richtext', extra);
const image = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'image', extra);
const url = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'url', extra);
const boolean = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'boolean', extra);
const number = (name: string, label: string, extra?: Extra): ContentField => field(name, label, 'number', extra);
const list = (name: string, label: string, itemFields: ContentField[], extra?: Extra): ContentField =>
  field(name, label, 'list', { itemFields, ...extra });

const CTA_HELP = 'Bağlantı: sayfa adı (urunler.html), çapa (#faq) ya da tam URL.';

/** Sıra = admin listesi sırası (sayfa sayfa). */
export const SITE_CONTENT_REGISTRY: readonly SiteContentRegistryEntry[] = [
  // ── Genel (tüm sayfalar) ──────────────────────────────────────────────────
  {
    key: 'promoBar',
    label: 'Promosyon şeridi (üst bant)',
    page: 'global',
    schema: {
      fields: [
        boolean('enabled', 'Göster', { required: true, help: 'Kapalıysa şerit hiç basılmaz.' }),
        richtext('html', 'Metin (HTML)', { required: true, help: 'index.html:101 — <b> ve <span class="mono"> serbest.' }),
      ],
    },
  },
  {
    key: 'footer',
    label: 'Alt bilgi (footer) — iletişim ve telif',
    page: 'global',
    schema: {
      fields: [
        text('phoneLabel', 'Telefon etiketi', { help: '"mutlu müşteri hattı"' }),
        text('phone', 'Telefon (görünen)', { required: true }),
        url('phoneHref', 'Telefon bağlantısı', { help: 'tel:+905… biçiminde' }),
        text('addressLabel', 'Adres etiketi'),
        text('addressLine1', 'Adres 1. satır'),
        text('addressLine2', 'Adres 2. satır'),
        url('mapsUrl', 'Harita bağlantısı'),
        url('instagramUrl', 'Instagram'),
        url('youtubeUrl', 'YouTube'),
        text('copyright', 'Telif satırı', { required: true }),
        text('policiesLabel', 'Politikalar bağlantı metni'),
        text('creditText', 'İmza metni'),
        url('creditUrl', 'İmza bağlantısı'),
      ],
    },
  },

  // ── Ana sayfa (index) ─────────────────────────────────────────────────────
  {
    key: 'home.hero',
    label: 'Ana sayfa — hero',
    page: 'index',
    schema: {
      fields: [
        richtext('title', 'Başlık (HTML)', { required: true, help: '<br> ve <em> serbest: "biz market değiliz.<br><em>seçiciyiz.</em>"' }),
        textarea('sub', 'Alt metin'),
        text('ctaText', 'Buton metni'),
        url('ctaHref', 'Buton bağlantısı', { help: CTA_HELP }),
        image('bgImage', 'Arka plan görseli', { help: 'assets/images/hero-crate.jpg' }),
      ],
    },
  },
  {
    key: 'home.pillars',
    label: 'Ana sayfa — değer sütunları (4)',
    page: 'index',
    schema: {
      fields: [
        list('items', 'Sütunlar', [text('title', 'Başlık', { required: true }), textarea('text', 'Metin', { required: true })], {
          required: true,
          min: 1,
          max: 8,
        }),
      ],
    },
  },
  {
    key: 'home.showcase',
    label: 'Ana sayfa — sezon vitrini (showcase)',
    page: 'index',
    schema: {
      fields: [
        image('image', 'Görsel'),
        text('imageAlt', 'Görsel alt metni'),
        text('eyebrow', 'Üst etiket', { help: '"Şu An Sezonda"' }),
        richtext('title', 'Başlık (HTML)', { required: true }),
        textarea('text', 'Metin'),
        text('ctaText', 'Buton metni'),
        url('ctaHref', 'Buton bağlantısı', { help: CTA_HELP }),
        text('productsTitle', 'Ürünler kutusu başlığı', { help: '"Tüm Ürünler" (sekmeler kategorilerden gelir)' }),
      ],
    },
  },
  {
    key: 'home.cloud',
    label: 'Ana sayfa — kategori bulutu',
    page: 'index',
    schema: {
      fields: [
        list('lines', 'Satırlar', [richtext('html', 'Satır (HTML)', { required: true, help: '&nbsp; ve <em> serbest' })], { min: 1, max: 6 }),
        text('ctaText', 'Buton metni'),
        url('ctaHref', 'Buton bağlantısı', { help: CTA_HELP }),
      ],
    },
  },
  {
    key: 'home.featured',
    label: 'Ana sayfa — öne çıkanlar (ürün/tier karışık sıra)',
    page: 'index',
    schema: {
      fields: [
        list(
          'items',
          'Kartlar',
          [
            field('type', 'Tür', 'select', {
              required: true,
              options: [
                { value: 'product', label: 'Ürün' },
                { value: 'tier', label: 'Kutu boyu' },
              ],
            }),
            text('ref', 'Slug (ürün ya da tier)', { required: true }),
            number('order', 'Sıra', { required: true, min: 0, max: 999 }),
          ],
          { required: true, min: 1, max: 24, help: 'Bootstrap\'ta olmayan ref atlanır (web/featured.ts).' },
        ),
      ],
    },
  },
  {
    key: 'home.blocks',
    label: 'Ana sayfa — metin blokları (öne çıkanlar başlığı, blog, toptan/hikaye)',
    page: 'index',
    schema: {
      fields: [
        richtext('offersTitle', 'Öne çıkanlar başlığı (HTML)'),
        textarea('offersText', 'Öne çıkanlar alt metni'),
        text('offersMoreText', '"tümünü gör" metni'),
        text('journalEyebrow', 'Blog üst etiketi'),
        richtext('journalTitle', 'Blog başlığı (HTML)'),
        text('journalCtaText', 'Blog buton metni'),
        url('journalCtaHref', 'Blog buton bağlantısı', { help: CTA_HELP }),
        text('swipeHint', 'Kaydırma ipucu', { help: '"kaydır"' }),
        text('solidEyebrow', 'Toptan bloğu üst etiketi'),
        richtext('solidTitle', 'Toptan bloğu başlığı (HTML)'),
        textarea('solidText', 'Toptan bloğu metni'),
        text('solidCtaText', 'Toptan bloğu buton metni'),
        url('solidCtaHref', 'Toptan bloğu buton bağlantısı', { help: CTA_HELP }),
        image('illustImage', 'Hikâye bloğu görseli'),
        text('illustImageAlt', 'Hikâye bloğu görsel alt metni'),
        text('illustCtaText', 'Hikâye bloğu buton metni'),
        url('illustCtaHref', 'Hikâye bloğu buton bağlantısı', { help: CTA_HELP }),
      ],
    },
  },
  {
    key: 'home.faq',
    label: 'Ana sayfa — SSS akordeonu',
    page: 'index',
    schema: {
      fields: [
        list('items', 'Sorular', [text('q', 'Soru', { required: true }), textarea('a', 'Cevap', { required: true })], {
          required: true,
          min: 1,
          max: 20,
        }),
      ],
    },
  },

  // ── Ürünler ───────────────────────────────────────────────────────────────
  {
    key: 'urunler.trust',
    label: 'Ürünler — güven satırı (Taze Kutular paneli)',
    page: 'urunler',
    schema: {
      fields: [
        list(
          'items',
          'Öğeler',
          [image('icon', 'İkon', { help: 'assets/icons/…' }), text('label', 'Başlık', { required: true }), text('sub', 'Alt metin')],
          { required: true, min: 1, max: 8 },
        ),
      ],
    },
  },

  // ── Kutu ──────────────────────────────────────────────────────────────────
  {
    key: 'kutu.notes',
    label: 'Kutu sayfası — sabit metinler ve notlar',
    page: 'kutu',
    schema: {
      fields: [
        text('crumbText', 'Geri bağlantısı metni', { help: '"← kutulara dön"' }),
        text('pairsLabel', 'Yan ürünler etiketi'),
        text('typeSubscribeLabel', '"abone ol" düğmesi'),
        text('typeOnetimeLabel', '"tek seferlik sipariş" düğmesi'),
        textarea('typeTipTitle', 'Sipariş türü ipucu (title özniteliği, düz metin)'),
        richtext('typeTipHtml', 'Sipariş türü ipucu (balon, HTML)', { help: '<br> serbest' }),
        textarea('editorNote', 'Kutu düzenleme notu'),
        textarea('editorNoteSubtle', 'Kutu düzenleme notu (ikincil)'),
        text('freqLabel', 'Gönderim sıklığı etiketi'),
        richtext('contentsTitle', '"bu haftaki içerik" başlığı (HTML)'),
        richtext('extrasTitle', '"kutuna ekstra ekle" başlığı (HTML)'),
        text('extrasBadge', 'Ekstra rozeti', { help: '"SINIRSIZ EKLEME HAKKI"' }),
        textarea('extrasNote', 'Ekstra açıklaması'),
        text('dayLabel', 'Teslimat günü etiketi'),
      ],
    },
  },

  // ── Nasıl seçiyoruz (manifesto) ───────────────────────────────────────────
  {
    key: 'manifesto.hero',
    label: 'Nasıl seçiyoruz — manifesto başlığı',
    page: 'nasil-seciyoruz',
    schema: {
      fields: [
        text('eyebrow', 'Üst etiket'),
        richtext('title', 'Başlık (HTML)', { required: true }),
        textarea('sub', 'Alt metin'),
        text('rule', 'Kural satırı', { help: '"İYİ DEĞİLSE BAĞDAM\'DA YOK."' }),
      ],
    },
  },
  {
    key: 'manifesto.compare',
    label: 'Nasıl seçiyoruz — karşılaştırma tablosu (3 sütun)',
    page: 'nasil-seciyoruz',
    schema: {
      fields: [
        richtext('title', 'Başlık (HTML)'),
        text('col1Title', '1. sütun başlığı'),
        list('col1Items', '1. sütun satırları', [text('label', 'Etiket', { required: true }), text('text', 'Değer', { required: true })], { min: 1, max: 8 }),
        text('col2Title', '2. sütun başlığı'),
        list('col2Items', '2. sütun satırları', [text('label', 'Etiket', { required: true }), text('text', 'Değer', { required: true })], { min: 1, max: 8 }),
        text('col3Title', '3. sütun başlığı (Bağdam, vurgulu)'),
        list('col3Items', '3. sütun satırları', [text('label', 'Etiket', { required: true }), text('text', 'Değer', { required: true })], { min: 1, max: 8 }),
        text('swipeHint', 'Kaydırma ipucu'),
      ],
    },
  },
  {
    key: 'manifesto.steps',
    label: 'Nasıl seçiyoruz — sistem adımları (metinler)',
    page: 'nasil-seciyoruz',
    schema: {
      fields: [
        list(
          'items',
          'Adımlar',
          [text('eyebrow', 'Üst etiket', { required: true, help: '"Sistem — 01"' }), richtext('title', 'Başlık (HTML)', { required: true }), textarea('text', 'Metin')],
          { required: true, min: 1, max: 6, help: 'Görsel kartlar şablonda sabittir; sıra adım sırasıdır.' },
        ),
      ],
    },
  },
  {
    key: 'manifesto.demo',
    label: 'Nasıl seçiyoruz — örnek kart metinleri',
    page: 'nasil-seciyoruz',
    schema: {
      fields: [
        text('ripenessLabel', 'Olgunluk kartı başlığı', { help: '"Gülbahçe Kavunu — nasıl seversin?"' }),
        text('ripenessOption1', 'Olgunluk seçeneği 1'),
        text('ripenessOption2', 'Olgunluk seçeneği 2 (seçili)'),
        text('ripenessNote', 'Olgunluk notu', { help: '"YEME ZAMANI: BUGÜN–YARIN"' }),
        text('curatorInitial', 'Küratör baş harfi'),
        text('curatorLabel', 'Küratör kartı etiketi'),
        text('curatorName', 'Küratör adı'),
      ],
    },
  },
  {
    key: 'manifesto.guarantee',
    label: 'Nasıl seçiyoruz — garanti bloğu',
    page: 'nasil-seciyoruz',
    schema: { fields: [richtext('title', 'Başlık (HTML)', { required: true }), textarea('text', 'Metin')] },
  },
  {
    key: 'manifesto.close',
    label: 'Nasıl seçiyoruz — kapanış',
    page: 'nasil-seciyoruz',
    schema: {
      fields: [richtext('title', 'Başlık (HTML)', { required: true }), text('ctaText', 'Buton metni'), url('ctaHref', 'Buton bağlantısı', { help: CTA_HELP })],
    },
  },

  // ── Toptan ────────────────────────────────────────────────────────────────
  {
    key: 'toptan.hero',
    label: 'Toptan — başlık bloğu',
    page: 'toptan',
    schema: {
      fields: [text('eyebrow', 'Üst etiket'), richtext('title', 'Başlık (HTML)', { required: true }), textarea('text', 'Metin')],
    },
  },
  {
    key: 'toptan.form',
    label: 'Toptan — form etiketleri ve mesajlar',
    page: 'toptan',
    schema: {
      fields: [
        text('emailPlaceholder', 'E-posta yer tutucusu'),
        text('submitText', 'Gönder düğmesi'),
        textarea('successMessage', 'Başarı mesajı', { required: true }),
        textarea('errorMessage', 'Hata mesajı (sunucu/ağ)', { required: true }),
        text('invalidEmailMessage', 'Geçersiz e-posta mesajı'),
      ],
    },
  },
  {
    key: 'toptan.details',
    label: 'Toptan — ayrıntı kutuları',
    page: 'toptan',
    schema: {
      fields: [
        list('items', 'Kutular', [text('title', 'Başlık', { required: true }), textarea('text', 'Metin', { required: true })], { min: 1, max: 6 }),
      ],
    },
  },

  // ── Günlük ────────────────────────────────────────────────────────────────
  {
    key: 'gunluk.hero',
    label: 'Günlük — başlık bloğu',
    page: 'gunluk',
    schema: { fields: [text('eyebrow', 'Üst etiket'), richtext('title', 'Başlık (HTML)', { required: true }), textarea('sub', 'Alt metin')] },
  },
  {
    key: 'gunluk.close',
    label: 'Günlük — kapanış',
    page: 'gunluk',
    schema: {
      fields: [richtext('title', 'Başlık (HTML)', { required: true }), text('ctaText', 'Buton metni'), url('ctaHref', 'Buton bağlantısı', { help: CTA_HELP })],
    },
  },

  // ── E-posta şablonları (F6 MailModule — ADR-0014: şablonlar DB'de; Handlebars) ─────────────────
  // Anahtar `mail.<slug>` = MailService.send({templateSlug}) → {subject, html}. Değişkenler her şablonda:
  // `brand` {name, webUrl, contactEmail, contactPhone, footerPhone, footerAddress, instagramUrl}; şablona özel: user, verifyUrl, resetUrl, lead …
  ...mailTemplateEntry('welcome', 'E-posta — hoş geldin', 'Değişkenler: {{user.name}} {{user.email}} {{brand.*}} {{{brand.webUrl}}}'),
  ...mailTemplateEntry('verify', 'E-posta — e-posta doğrulama', 'Değişkenler: {{{verifyUrl}}} (24 saat geçerli; bağlantılar üç süslü parantez) {{user.*}} {{brand.*}}'),
  ...mailTemplateEntry('reset', 'E-posta — parola sıfırlama', 'Değişkenler: {{{resetUrl}}} {{expiresMinutes}} {{user.*}} {{brand.*}}'),
  ...mailTemplateEntry('password-changed', 'E-posta — parola değişti', 'Değişkenler: {{user.*}} {{brand.*}} {{changedAt}}'),
  ...mailTemplateEntry('wholesale-lead', 'E-posta — yeni toptan talebi (yöneticiye)', 'Değişkenler: {{lead.email}} {{lead.businessName}} {{lead.phone}} {{lead.note}} {{lead.createdAt}} {{{adminUrl}}}'),
  ...mailTemplateEntry('test', 'E-posta — test gönderimi (Ayarlar › E-posta)', 'Değişkenler: {{sentAt}} {{brand.*}}'),
];

/**
 * `mail.<slug>` girdisi — subject (metin, Handlebars) + html (richtext, Handlebars). `{{var}}` HTML-kaçışlı (metin),
 * `{{{var}}}` ham — bağlantılar (verifyUrl/resetUrl/brand.webUrl/adminUrl) üç süslü parantezle yazılır (= işareti kaçışlanmasın).
 */
function mailTemplateEntry(slug: string, label: string, help: string): SiteContentRegistryEntry[] {
  return [
    {
      key: `mail.${slug}`,
      label,
      page: 'mail',
      schema: {
        fields: [
          text('subject', 'Konu (Handlebars)', { required: true, help }),
          richtext('html', 'Gövde (HTML + Handlebars)', { required: true, help: 'Tam HTML belge gerekmez; MailService metin gövdesini olduğu gibi gönderir.' }),
        ],
      },
    },
  ];
}

const BY_KEY: ReadonlyMap<string, SiteContentRegistryEntry> = new Map(SITE_CONTENT_REGISTRY.map((e) => [e.key, e]));

export function getSiteContentRegistryEntry(key: string): SiteContentRegistryEntry | undefined {
  return BY_KEY.get(key);
}

export const SITE_CONTENT_KEYS: readonly string[] = SITE_CONTENT_REGISTRY.map((e) => e.key);
