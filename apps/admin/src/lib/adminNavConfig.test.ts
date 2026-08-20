import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROOT,
  BOTTOM_NAV_KEYS,
  adminNavItems,
  findAdminNavGroup,
  findAdminNavLeaf,
  getAdminPageLabel,
  getAllNavLeaves,
  navLinkEnd,
} from './adminNavConfig';

/** F4'te gerçek sayfaya bağlanan ekranlar (BACKEND-PLANI §4, 1–8; Giriş menüde değil). */
const F4_LIVE_PATHS = [
  '/katalog/urunler',
  '/katalog/kategoriler',
  '/katalog/ureticiler',
  '/katalog/kutular',
  '/katalog/haftanin-kutusu',
  '/medya',
];

describe('adminNavConfig (Bağdam menüsü)', () => {
  it('tüm yollar benzersiz ve / ile başlar', () => {
    const leaves = getAllNavLeaves();
    const paths = leaves.map((l) => l.to);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith('/')).toBe(true);
  });

  it('her ekran faz etiketi taşır', () => {
    for (const leaf of getAllNavLeaves()) {
      expect(leaf.phase, `${leaf.to} faz etiketi`).toBeTruthy();
    }
  });

  it('F4 ekranları (2–8) gerçek sayfaya bağlı: comingSoon=false; diğerleri yer tutucu', () => {
    for (const leaf of getAllNavLeaves()) {
      if (F4_LIVE_PATHS.includes(leaf.to)) {
        expect(leaf.phase, leaf.to).toBe('F4');
        expect(leaf.comingSoon, `${leaf.to} comingSoon`).toBe(false);
      } else {
        expect(leaf.comingSoon, `${leaf.to} comingSoon`).toBe(true);
      }
    }
    // F4 fazındaki tüm leaf'ler bağlı olmalı (F4'te eksik ekran kalmasın)
    const f4 = getAllNavLeaves().filter((l) => l.phase === 'F4');
    expect(f4.map((l) => l.to).sort()).toEqual([...F4_LIVE_PATHS].sort());
  });

  it('BACKEND-PLANI §4 ekranları menüde', () => {
    const labels = getAllNavLeaves().map((l) => l.label);
    for (const expected of [
      'Özet', 'Ürünler', 'Kategoriler', 'Üreticiler', 'Kutular', 'Haftanın Kutusu', 'Medya',
      'Site İçerikleri', 'Günlük', 'Yasal Metinler', 'Toptan Talepleri', 'Müşteriler', 'Siparişler',
      'Abonelikler', 'Teslimat Günü', 'Ödeme Problemleri', 'Bölgeler', 'Teslimat Tarihleri',
      'E-posta', 'Ödeme', 'SEO', 'Genel', 'Sistem Durumu',
    ]) {
      expect(labels, expected).toContain(expected);
    }
  });

  it('alt çubuk anahtarları menüde var (5 + Daha Fazla = 6 sütun)', () => {
    expect(BOTTOM_NAV_KEYS).toHaveLength(5);
    for (const key of BOTTOM_NAV_KEYS) {
      expect(adminNavItems.some((i) => i.label === key), key).toBe(true);
    }
  });

  it('yol → etiket / grup çözümü', () => {
    expect(getAdminPageLabel(ADMIN_ROOT)).toBe('Özet');
    expect(getAdminPageLabel('/katalog/urunler')).toBe('Ürünler');
    expect(getAdminPageLabel('/katalog/urunler/123')).toBe('Ürünler');
    expect(getAdminPageLabel('/katalog/urunler/yeni')).toBe('Ürünler');
    expect(getAdminPageLabel('/ayarlar/bolgeler')).toBe('Bölgeler');
    expect(getAdminPageLabel('/ayarlar')).toBe('Genel');
    expect(getAdminPageLabel('/olmayan')).toBe('Yönetim');
    expect(findAdminNavLeaf('/olmayan')).toBeUndefined();
    expect(findAdminNavGroup('/ayarlar/seo')?.label).toBe('Ayarlar');
    expect(findAdminNavGroup('/medya')?.label).toBe('Katalog');
    expect(findAdminNavGroup(ADMIN_ROOT)).toBeUndefined();
  });

  it('navLinkEnd: altında başka leaf olan yollar yalnız tam eşleşmede aktif', () => {
    expect(navLinkEnd('/ayarlar')).toBe(true);
    expect(navLinkEnd('/ayarlar/bolgeler')).toBe(false);
    expect(navLinkEnd('/katalog/urunler')).toBe(false);
    expect(navLinkEnd(ADMIN_ROOT)).toBe(true);
  });
});
