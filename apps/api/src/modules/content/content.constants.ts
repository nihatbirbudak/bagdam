/**
 * ContentModule sabitleri (F5). Cache anahtarları `<modül>:<kaynak>` kalıbında (common/cache-keys.ts ile aynı
 * adlandırma; içerik anahtarları burada toplanır ki admin mutasyonları doğru anahtarı düşürsün).
 */
export const CONTENT_CACHE_KEYS = {
  /** SiteContent satırları (key → {schema,value}) — her sayfa render'ında okunur. */
  siteContentRows: 'content:site-content:rows',
  /** politikalar nav (isCurrent && showInNav). */
  legalNav: 'content:legal:nav',
  /** Yayındaki tüm yasal belgeler (GET /legal). */
  legalCurrent: 'content:legal:current',
  /** Yayındaki günlük yazıları (tamamı; sayfalama bellekte). */
  publishedPosts: 'content:posts:published',
} as const;

/** İçerik cache TTL (ms) — yazımda invalidate edilir; TTL yalnız emniyet (çoklu instance'ta eskime sınırı). */
export const CONTENT_CACHE_TTL_MS = 5 * 60_000;

/** `GET /posts?limit=` varsayılanı ve üst sınırı. */
export const POSTS_PUBLIC_DEFAULT_LIMIT = 10;
export const POSTS_PUBLIC_MAX_LIMIT = 50;

/** Admin liste varsayılanları. */
export const ADMIN_DEFAULT_PAGE = 1;
export const ADMIN_DEFAULT_LIMIT = 25;

/** Consent.source varsayılanı (şema @default("HS_WEB")). */
export const DEFAULT_CONSENT_SOURCE = 'HS_WEB';

/** `POST /consents` hız sınırı (IP başına / dk) — çerez banner'ı + pazarlama izni için yeterli. */
export const CONSENTS_THROTTLE = { limit: 30, ttl: 60_000 } as const;

/** sitemap.xml / robots.txt — WEB_URL yoksa üretim alan adı (ADR-0012). */
export const DEFAULT_WEB_URL = 'https://bagdam.com';
