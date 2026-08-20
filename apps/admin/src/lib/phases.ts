/** docs/YOL-HARITASI.md fazları — panelde durum kartı ve yer tutucu sayfalarda gösterilir. */

export type PhaseKey = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11';
export type PhaseStatus = 'done' | 'active' | 'planned';

export interface PhaseInfo {
  key: PhaseKey;
  title: string;
  summary: string;
  /** Tahmini iş günü (tek geliştirici). */
  days: number;
  status: PhaseStatus;
}

/** Şu anki faz; faz bitince güncellenir (SISTEM-DURUMU ile birlikte). */
export const CURRENT_PHASE: PhaseKey = 'F1';

export const PHASES: PhaseInfo[] = [
  { key: 'F0', title: 'Karar sprinti', summary: '16 ADR; Cloudflare, iyzico sandbox, e-posta sağlayıcısı kararları.', days: 2, status: 'active' },
  { key: 'F1', title: 'Walking skeleton', summary: 'Monorepo, API health, .hbs site, admin kabuğu, sunucu/nginx/SSL, CI/CD, yedek.', days: 4, status: 'active' },
  { key: 'F2', title: 'Şema-a + seed + paylaşılan kurallar', summary: 'Prisma F2a modelleri, migration, seed, packages/shared pricing.', days: 3, status: 'planned' },
  { key: 'F3', title: 'Inline bootstrap + katalog dinamik', summary: 'GET /bootstrap, bootstrap partial, cart.js yaması.', days: 2, status: 'planned' },
  { key: 'F4', title: 'Admin iskeleti + auth + katalog CRUD + medya', summary: 'AuthModule, ekranlar 1–8, MediaModule, audit.', days: 6, status: 'planned' },
  { key: 'F5', title: 'CMS içerik + günlük + yasal + toptan + ayarlar', summary: 'Content / Wholesale / Settings modülleri, ekranlar 9–15.', days: 6, status: 'planned' },
  { key: 'F6', title: 'Üyelik + hesap + adres + e-posta', summary: 'Müşteri auth, MeModule, MailModule, ekran 16.', days: 4, status: 'planned' },
  { key: 'F7', title: 'Şema-b + fiyatlama + abonelik motoru', summary: 'Commerce şeması, PricingService, cycles:*, testler.', days: 9, status: 'planned' },
  { key: 'F8', title: 'Checkout + sipariş + iyzico', summary: 'iyzico adaptörü, checkout, callback, ekran 17.', days: 6, status: 'planned' },
  { key: 'F9', title: 'Web etkileşimli sayfalar + ops ekranları', summary: 'BahcedenCart.remote, ekranlar 14b ve 18–21.', days: 7, status: 'planned' },
  { key: 'F10', title: 'Bildirimler + yasal/çerez + KVKK + sertleştirme', summary: 'E-posta şablonları, çerez banner, purge, şema v1 dondurma, ekran 22.', days: 4, status: 'planned' },
  { key: 'F11', title: 'Lansman + hypercare', summary: 'Prod anahtarları, apex açılışı, 2 hafta günlük rapor.', days: 2, status: 'planned' },
];

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  done: 'Tamamlandı',
  active: 'Devam ediyor',
  planned: 'Planlı',
};

export function getPhase(key: string): PhaseInfo | undefined {
  return PHASES.find((p) => p.key === key);
}
