/**
 * SITE_MODE (ADR-0012): F1'de apex coming-soon gösterir, tam site yalnız staging'de.
 * - `full`        → `/` ve `/index.html` ana sayfayı render eder (varsayılan)
 * - `coming-soon` → `/` ve `/index.html` coming-soon.hbs'e düşer; diğer sayfalar 404
 * F11'de apex `full`a alınır; bu dosya değişmez.
 */
export const SITE_MODES = ['full', 'coming-soon'] as const;

export type SiteMode = (typeof SITE_MODES)[number];

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === 'string' && (SITE_MODES as readonly string[]).includes(value);
}

/** Çağrı anında env'den okur (testlerde değiştirilebilsin diye modül sabiti değil). */
export function getSiteMode(): SiteMode {
  const raw = process.env.SITE_MODE?.trim();
  return isSiteMode(raw) ? raw : 'full';
}
