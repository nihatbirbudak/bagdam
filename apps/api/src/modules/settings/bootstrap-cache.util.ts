import type { Cache } from 'cache-manager';
import { CACHE_KEYS } from '../../common/cache-keys';

/**
 * Anonim bootstrap cache'ini düşürür — `CatalogService.invalidateBootstrapCache()` ile AYNI etki
 * (aynı anahtar: CACHE_KEYS.bootstrapAnonymous). Settings/Delivery modülleri CatalogService yerine doğrudan
 * CACHE_MANAGER üzerinden çağırır ki CatalogModule ↔ Settings/Delivery arasında döngüsel modül bağımlılığı
 * oluşmasın (E, CatalogService'i DeliveryService/SettingsService'e bağladığında forwardRef gerekmez).
 */
export async function invalidateBootstrapCache(cache: Cache): Promise<void> {
  await cache.del(CACHE_KEYS.bootstrapAnonymous);
}
