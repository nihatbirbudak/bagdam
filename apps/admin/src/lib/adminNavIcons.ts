import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarDays,
  CreditCard,
  FileText,
  Gift,
  ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  Layers,
  Library,
  Mail,
  MapPin,
  Megaphone,
  MoreHorizontal,
  Newspaper,
  Package,
  Receipt,
  Repeat,
  Scale,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Tractor,
  Truck,
  Users,
} from 'lucide-react';
import { ADMIN_ROOT } from './adminNavConfig';

/** Menü grubu başlığı ikonları (modül düzeyinde sabit tablo; render sırasında bileşen üretilmez). */
const GROUP_ICONS: Record<string, LucideIcon> = {
  'Katalog': Package,
  'İçerik': Library,
  'Satış': ShoppingBag,
  'Operasyon': Truck,
  'Ayarlar': Settings,
  'Sistem': Activity,
};

export function getAdminGroupIcon(label: string): LucideIcon {
  return GROUP_ICONS[label] ?? LayoutGrid;
}

/** Alt çubuk "Daha Fazla" ikonu. */
export { MoreHorizontal };

const LINK_ICONS: Record<string, LucideIcon> = {
  '/katalog/urunler': Package,
  '/katalog/kategoriler': Layers,
  '/katalog/ureticiler': Tractor,
  '/katalog/kutular': Boxes,
  '/katalog/haftanin-kutusu': Gift,
  '/medya': ImageIcon,
  '/icerik/site': LayoutTemplate,
  '/icerik/promo-footer': Megaphone,
  '/icerik/gunluk': Newspaper,
  '/icerik/yasal-metinler': Scale,
  '/toptan-talepleri': Store,
  '/musteriler': Users,
  '/siparisler': Receipt,
  '/abonelikler': Repeat,
  '/odeme-problemleri': AlertTriangle,
  '/operasyon/teslimat-gunu': Truck,
  '/ayarlar': SlidersHorizontal,
  '/ayarlar/bolgeler': MapPin,
  '/ayarlar/teslimat-tarihleri': CalendarDays,
  '/ayarlar/e-posta': Mail,
  '/ayarlar/odeme': CreditCard,
  '/ayarlar/seo': Search,
  '/sistem': Activity,
};

/** Tekil rota ikonu; mobil ve masaüstü link satırlarında kullanılır. */
export function getAdminLinkIcon(to: string): LucideIcon {
  if (to === ADMIN_ROOT) return LayoutGrid;
  return LINK_ICONS[to] ?? FileText;
}
