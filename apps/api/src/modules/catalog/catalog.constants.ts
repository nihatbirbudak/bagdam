/** Varsayılan teslimat bölgesi (ADR-0005 Urla) — products.js DELIVERY_FEE = 49 bu bölgenin ücretidir. */
export const DEFAULT_ZONE_SLUG = 'urla';

/** Bootstrap `deliveryDates` ufku (hafta) — BACKEND-PLANI §3: `GET /delivery/dates?zone=&weeks=4`. */
export const BOOTSTRAP_DELIVERY_WEEKS = 4;

/** products.js FREQ_OPTIONS[].note — tüm seçeneklerde sabit metin [B21]. */
export const FREQ_OPTION_NOTE = 'seçtiğin gün';

/** Setting grubu ve anahtar öneki: `commerce.<alan>` (seed: COMMERCE_SETTINGS_DEFAULTS anahtarları). */
export const COMMERCE_SETTING_GROUP = 'commerce';
export const COMMERCE_SETTING_PREFIX = `${COMMERCE_SETTING_GROUP}.`;
