export const ADMIN_ROOT = '/' as const;

/* ── Tip sistemi ─────────────────────────────────────────── */

/** Ekranın geldiği faz (docs/YOL-HARITASI.md). */
export type AdminPhase = 'F1' | 'F4' | 'F5' | 'F6' | 'F8' | 'F9' | 'F10';

export type AdminNavLeaf = {
  label: string;
  to: string;
  phase?: AdminPhase;
  /** Yer tutucu ekran; gerçek sayfa bağlanınca false yapılır (F4: ekranlar 1–8 bağlı). */
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
    comingSoon: true,
    hint: 'Türetilmiş göstergeler: bugünkü teslimatlar, bekleyen ödemeler, haftalık kutu doluluğu.',
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
      { label: 'Site İçerikleri', to: '/icerik/site', phase: 'F5', comingSoon: true, hint: 'Site blokları (home.featured, hero, SSS), promo, footer, iletişim.' },
      { label: 'Günlük', to: '/icerik/gunluk', phase: 'F5', comingSoon: true, hint: 'Blog yazıları (posts).' },
      { label: 'Yasal Metinler', to: '/icerik/yasal-metinler', phase: 'F5', comingSoon: true, hint: 'Versiyonlu yasal belgeler; showInNav; requiresAck.' },
      { divider: 'Talepler' },
      { label: 'Toptan Talepleri', to: '/toptan-talepleri', phase: 'F5', comingSoon: true, hint: 'toptan.html formundan gelen talepler (wholesale_leads).' },
    ],
  },
  {
    label: 'Satış',
    children: [
      { label: 'Müşteriler', to: '/musteriler', phase: 'F6', comingSoon: true, hint: 'Kullanıcı, adres, sipariş, abonelik, kart, rızalar; anonimleştir.' },
      { label: 'Siparişler', to: '/siparisler', phase: 'F8', comingSoon: true, hint: 'Durum geçişleri, iade, fatura no/PDF, kurumsal fatura alanları.' },
      { label: 'Abonelikler', to: '/abonelikler', phase: 'F9', comingSoon: true, hint: 'Abonelik, cycle, cycle içerikleri, olaylar, iptaller; tek seferlik kutular da burada.' },
      { label: 'Ödeme Problemleri', to: '/odeme-problemleri', phase: 'F9', comingSoon: true, hint: "UNPAID / AWAITING_PAYMENT cycle'lar: link gönder, yeniden çek." },
    ],
  },
  {
    label: 'Operasyon',
    children: [
      { label: 'Teslimat Günü', to: '/operasyon/teslimat-gunu', phase: 'F9', comingSoon: true, hint: 'Pick / packing / etiket; toplu durum; telafi.' },
    ],
  },
  {
    label: 'Ayarlar',
    children: [
      { label: 'Genel', to: '/ayarlar', phase: 'F5', comingSoon: true, hint: 'Genel ayar grupları (commerce.* vb.) — generic grup formu.' },
      { label: 'Bölgeler', to: '/ayarlar/bolgeler', phase: 'F5', comingSoon: true, hint: 'Teslimat bölgeleri: ücret / eşik / kapasite.' },
      { label: 'Teslimat Tarihleri', to: '/ayarlar/teslimat-tarihleri', phase: 'F9', comingSoon: true, hint: 'Doluluk, günü kapat.' },
      { label: 'E-posta', to: '/ayarlar/e-posta', phase: 'F5', comingSoon: true, hint: 'Sağlayıcı ayarları (şifreli); test gönderimi.' },
      { label: 'Ödeme', to: '/ayarlar/odeme', phase: 'F5', comingSoon: true, hint: 'iyzico anahtarları (şifreli), tahsilat stratejisi.' },
      { label: 'SEO', to: '/ayarlar/seo', phase: 'F5', comingSoon: true, hint: 'Başlık/açıklama şablonları, sitemap/robots.' },
    ],
  },
  {
    label: 'Sistem',
    children: [
      { label: 'Sistem Durumu', to: '/sistem', phase: 'F10', comingSoon: true, hint: 'Audit / system / cron / mail / webhook günlükleri; sağlık.' },
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
