/**
 * In-process cache anahtarları (CacheModule @Global — cache-manager v7, TTL milisaniye).
 * Adlandırma: `<modül>:<kaynak>[:<ayrıntı>]`. Anahtarlar burada toplanır ki admin mutasyonları (F4)
 * doğru anahtarı düşürsün; string başka yerde tekrar yazılmaz.
 */
export const CACHE_KEYS = {
  /** CatalogService.getBootstrap anonim yükü (me/sub null) — BACKEND-PLANI §3 catalog: 60 s. */
  bootstrapAnonymous: 'catalog:bootstrap:anon',
  /** CatalogService.listActiveCategories — web sekmeleri/panel notları (F5); kategori mutasyonunda bootstrap ile birlikte düşer. */
  categoriesActive: 'catalog:categories:active',
} as const;

/** Anonim bootstrap TTL (ms) — `Cache-Control: public, max-age=60` ile aynı süre. */
export const BOOTSTRAP_CACHE_TTL_MS = 60_000;
