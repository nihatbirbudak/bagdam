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

describe('adminNavConfig (Bağdam menüsü)', () => {
  it('tüm yollar benzersiz ve / ile başlar', () => {
    const leaves = getAllNavLeaves();
    const paths = leaves.map((l) => l.to);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith('/')).toBe(true);
  });

  it('F1: kök hariç her ekran faz etiketi taşır ve comingSoon', () => {
    for (const leaf of getAllNavLeaves()) {
      expect(leaf.phase, `${leaf.to} faz etiketi`).toBeTruthy();
      expect(leaf.comingSoon, `${leaf.to} comingSoon`).toBe(true);
    }
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
    expect(getAdminPageLabel('/ayarlar/bolgeler')).toBe('Bölgeler');
    expect(getAdminPageLabel('/ayarlar')).toBe('Genel');
    expect(getAdminPageLabel('/olmayan')).toBe('Yönetim');
    expect(findAdminNavLeaf('/olmayan')).toBeUndefined();
    expect(findAdminNavGroup('/ayarlar/seo')?.label).toBe('Ayarlar');
    expect(findAdminNavGroup(ADMIN_ROOT)).toBeUndefined();
  });

  it('navLinkEnd: altında başka leaf olan yollar yalnız tam eşleşmede aktif', () => {
    expect(navLinkEnd('/ayarlar')).toBe(true);
    expect(navLinkEnd('/ayarlar/bolgeler')).toBe(false);
    expect(navLinkEnd(ADMIN_ROOT)).toBe(true);
  });
});
