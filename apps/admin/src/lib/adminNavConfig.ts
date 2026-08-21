export const ADMIN_ROOT = '/' as const;

/* ── Tip sistemi ─────────────────────────────────────────── */

/** Ekranın geldiği faz (docs/YOL-HARITASI.md). */
export type AdminPhase = 'F1' | 'F4' | 'F5' | 'F6' | 'F8' | 'F9' | 'F10';

export type AdminNavLeaf = {
  label: string;
  to: string;
  phase?: AdminPhase;
  /** Yer tutucu ekran; gerçek sayfa bağlanınca false yapılır (F4: 1–8, F5: 9–15, F6: 16 + e-posta günlüğü, F8: 17 + 23, F9: 21 Özet + 14b + 18 + 19 + 20, F10: 22 Sistem bağlı). */
  comingSoon?: boolean;
  /** Yer tutucu sayfada gösterilen kısa kapsam notu (BACKEND-PLANI §4). */
  hint?: string;
};
export type AdminNavDivider = { divider: string };
export type AdminNavGroupChild = AdminNavLeaf | AdminNavDivider;
export type AdminNavGroup = { label: string; children: AdminNavGroupChild[] };
export type AdminNavItem = AdminNavLeaf | AdminNavGroup;

export function isAdminNavGroup(item: AdminNavItem): item is AdminNavGroup {
  return 'children' in item;
}
export function isNavDivider(child: AdminNavGroupChild): child is AdminNavDivider {
  return 'divider' in child;
}
export function isNavLeaf(child: AdminNavGroupChild): child is AdminNavLeaf {
  return 'to' in child;
}

/* ── Bağdam menüsü (BACKEND-PLANI §4 ekran listesi) ──────── */

export const adminNavItems: AdminNavItem[] = [
  {
    label: 'Özet',
    to: ADMIN_ROOT,
    phase: 'F9',
    comingSoon: false,
    hint: 'Türetilmiş göstergeler: bugünkü/haftalık sipariş ve ciro, aktif abonelikler, bu haftanın kesim durumu, ödeme problemleri, son olaylar.',
  },
  {
    label: 'Katalog',
    children: [
      {
        label: 'Ürünler',
        to: '/katalog/urunler',
        phase: 'F4',
        comingSoon: false,
        hint: 'Liste: filtre, sürükle-sırala, eş ürün (pair), stok durumu. Form: Genel · Fiyat/KDV · Kutu · Tercih · Metinler · Partiler · Görseller.',
      },
      { label: 'Kategoriler', to: '/katalog/kategoriler', phase: 'F4', comingSoon: false, hint: 'Ad, panel notu, sıra (ikon statik).' },
      { label: 'Üreticiler', to: '/katalog/ureticiler', phase: 'F4', comingSoon: false, hint: 'Ad / köy / ilçe; hikâye ve foto alanı.' },
      { label: 'Kutular', to: '/katalog/kutular', phase: 'F4', comingSoon: false, hint: 'Kutu boyları (tier): fiyat, kapasite, görsel.' },
      {
        label: 'Haftanın Kutusu',
        to: '/katalog/haftanin-kutusu',
        phase: 'F4',
        comingSoon: false,
        hint: 'Hafta → tier başına içerik; swap; küratör notu; kopyala; yayınla (yayınlanınca kutu.html şablonu basar).',
      },
      { divider: 'Dosyalar' },
      { label: 'Medya', to: '/medya', phase: 'F4', comingSoon: false, hint: 'Görsel kütüphanesi: import edilen 58 görsel, klasörler, seçici.' },
    ],
  },
  {
    label: 'İçerik',
    children: [
      {
        label: 'Site İçerikleri',
        to: '/icerik/site',
        phase: 'F5',
        comingSoon: false,
        hint: 'Site blokları: ana sayfa (hero, sütunlar, vitrin, öne çıkanlar, SSS), ürünler, kutu, manifesto, toptan, günlük metinleri — şemadan üretilen form.',
      },
      {
        label: 'Promo / Footer / İletişim',
        to: '/icerik/promo-footer',
        phase: 'F5',
        comingSoon: false,
        hint: 'Üst promosyon şeridi (promoBar) ile alt bilgi ve iletişim (footer) blokları.',
      },
      { label: 'Günlük', to: '/icerik/gunluk', phase: 'F5', comingSoon: false, hint: 'Blog yazıları (posts): taslak/yayın, kapak görseli, ilgili yazılar.' },
      { label: 'Yasal Metinler', to: '/icerik/yasal-metinler', phase: 'F5', comingSoon: false, hint: 'Versiyonlu yasal belgeler; taslak → yayınla; nav/sıra/onay zorunluluğu.' },
      { divider: 'Talepler' },
      { label: 'Toptan Talepleri', to: '/toptan-talepleri', phase: 'F5', comingSoon: false, hint: 'toptan.html formundan gelen talepler (wholesale_leads): durum ve not.' },
    ],
  },
  {
    label: 'Satış',
    children: [
      {
        label: 'Müşteriler',
        to: '/musteriler',
        phase: 'F6',
        comingSoon: false,
        hint: 'Liste (arama, rol, son giriş, e-posta doğrulama), detay (profil, adres, onaylar, audit özeti, siparişler), düzenle, KVKK anonimleştir.',
      },
      { label: 'Siparişler', to: '/siparisler', phase: 'F8', comingSoon: false, hint: 'Liste (durum/tür/tarih/arama, CSV), detay: satırlar, ödemeler, iade, durum geçişleri, notlar, fatura no/PDF, kurumsal fatura alanları.' },
      { label: 'Kuponlar', to: '/kuponlar', phase: 'F8', comingSoon: false, hint: 'İndirim kuponları: oluştur/düzenle, aktif-pasif, kullanımlar (CouponRedemption).' },
      { label: 'Abonelikler', to: '/abonelikler', phase: 'F9', comingSoon: false, hint: 'Liste (durum/tier/gün/sonraki teslimat/dunning); detay: cycle geçmişi, olay günlüğü, iptal kayıtları, düzenleme, telafi. Tek seferlik kutular da burada (isOneTime).' },
      { label: 'Ödeme Problemleri', to: '/odeme-problemleri', phase: 'F9', comingSoon: false, hint: "UNPAID / AWAITING_PAYMENT cycle'lar ve PAYMENT_FAILED siparişler: yeniden çek, ödeme linki gönder, müşteriye not." },
    ],
  },
  {
    label: 'Operasyon',
    children: [
      { label: 'Teslimat Günü', to: '/operasyon/teslimat-gunu', phase: 'F9', comingSoon: false, hint: 'Tarih + bölge; kutu ve sipariş listesi, toplama/paketleme listeleri (yazdırma), toplu durum ilerletme, telafi.' },
    ],
  },
  {
    label: 'Ayarlar',
    children: [
      { label: 'Genel', to: '/ayarlar', phase: 'F5', comingSoon: false, hint: 'Genel ayar grupları (ticaret/kampanya, site, çerez) — registry’den üretilen grup formu.' },
      { label: 'Bölgeler', to: '/ayarlar/bolgeler', phase: 'F5', comingSoon: false, hint: 'Teslimat bölgeleri: ücret / eşik / kapasite; teslimat tarihleri önizleme.' },
      { label: 'Teslimat Tarihleri', to: '/ayarlar/teslimat-tarihleri', phase: 'F9', comingSoon: false, hint: 'Bölge + hafta; gün/tarih/kesim/rezerve/kapasite/durum; kapasite düzenle, günü kapat-aç, tarih üret.' },
      { label: 'E-posta', to: '/ayarlar/e-posta', phase: 'F5', comingSoon: false, hint: 'E-posta ve SMS sağlayıcı ayarları (şifreli); test gönderimi.' },
      { label: 'Ödeme', to: '/ayarlar/odeme', phase: 'F5', comingSoon: false, hint: 'PayTR mağaza bilgileri (şifreli), test modu, callback IP listesi, kayıtlı kart (ADR-0019).' },
      { label: 'SEO', to: '/ayarlar/seo', phase: 'F5', comingSoon: false, hint: 'Sayfa başlıkları/açıklama, OG görseli; sitemap/robots API’den.' },
    ],
  },
  {
    label: 'Sistem',
    children: [
      {
        label: 'Sistem Durumu',
        to: '/sistem',
        phase: 'F10',
        comingSoon: false,
        hint: 'Sağlık kartı (DB, zamanlayıcı, 24 saatlik sayımlar, uyarılar) + denetim / sistem / cron / e-posta / webhook günlükleri; işleri elle çalıştırma (yalnız dev/staging).',
      },
      { divider: 'Günlükler' },
      {
        label: 'E-posta Günlüğü',
        to: '/sistem/e-posta-gunlugu',
        phase: 'F6',
        comingSoon: false,
        hint: 'MailLog: alıcı, konu, şablon, durum (SENT / FAILED / SKIPPED), hata; DISABLE_MAIL önizleme dosyası yolu yalnız dev.',
      },
    ],
  },
];

/* ── Alt çubukta (mobil) gösterilecek grup/leaf etiketleri ── */

export const BOTTOM_NAV_KEYS = ['Özet', 'Katalog', 'Satış', 'Operasyon', 'Ayarlar'] as const;

/* ── Yardımcılar ─────────────────────────────────────────── */

export function getGroupLeaves(group: AdminNavGroup): AdminNavLeaf[] {
  return group.children.filter(isNavLeaf);
}

/** Tüm leaf'ler (üst düzey + grup içi), menü sırasıyla. */
export function getAllNavLeaves(): AdminNavLeaf[] {
  const out: AdminNavLeaf[] = [];
  for (const item of adminNavItems) {
    if (isAdminNavGroup(item)) out.push(...getGroupLeaves(item));
    else out.push(item);
  }
  return out;
}

const leavesByLength = getAllNavLeaves().slice().sort((a, b) => b.to.length - a.to.length);

/** Yola en iyi uyan leaf: önce tam eşleşme, sonra en uzun önek. */
export function findAdminNavLeaf(pathname: string): AdminNavLeaf | undefined {
  if (pathname === ADMIN_ROOT) return getAllNavLeaves().find((l) => l.to === ADMIN_ROOT);
  const exact = leavesByLength.find((l) => l.to === pathname);
  if (exact) return exact;
  return leavesByLength.find((l) => l.to !== ADMIN_ROOT && pathname.startsWith(`${l.to}/`));
}

/** Leaf'in bağlı olduğu grup (üst düzey leaf ise undefined). */
export function findAdminNavGroup(pathname: string): AdminNavGroup | undefined {
  const leaf = findAdminNavLeaf(pathname);
  if (!leaf) return undefined;
  return adminNavItems.find(
    (item): item is AdminNavGroup => isAdminNavGroup(item) && getGroupLeaves(item).some((l) => l.to === leaf.to),
  );
}

export function getAdminPageLabel(pathname: string): string {
  return findAdminNavLeaf(pathname)?.label ?? 'Yönetim';
}

export function isAdminNavGroupActive(group: AdminNavGroup, pathname: string): boolean {
  return getGroupLeaves(group).some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`));
}

/**
 * NavLink `end` kararı: başka bir leaf bu yolun altındaysa (ör. /ayarlar ve /ayarlar/bolgeler)
 * üst yol yalnız tam eşleşmede aktif olmalı.
 */
export function navLinkEnd(to: string): boolean {
  if (to === ADMIN_ROOT) return true;
  return leavesByLength.some((l) => l.to !== to && l.to.startsWith(`${to}/`));
}
