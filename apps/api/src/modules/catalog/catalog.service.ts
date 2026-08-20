import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDateIn,
  DEFAULT_TZ,
  isoDateToUtc,
  weekdayOf,
  type BootstrapMe,
  type BootstrapPayload,
  type BootstrapSub,
  type BootstrapTemplates,
  type BoxTemplate,
  type BoxTier,
  type IsoDate,
  type Producer,
  type Product,
} from '@bagdam/shared';
import type { Cache } from 'cache-manager';
import { BOOTSTRAP_CACHE_TTL_MS, CACHE_KEYS } from '../../common/cache-keys';
import { BOOTSTRAP_DELIVERY_WEEKS, COMMERCE_SETTING_GROUP, DEFAULT_ZONE_SLUG } from './catalog.constants';
import {
  mergeCommerceSettings,
  templateProductSlugs,
  toBootstrapCommerce,
  toBootstrapProduct,
  toBoxTemplateDto,
  toBoxTierDto,
  toDeliveryDate,
  toDeliveryDayOptions,
  toFreqOptions,
  toMoney,
  toProducerDto,
  toProductDto,
  toSubTier,
} from './catalog.mapper';
import { CatalogRepository, type ActiveCategoryRecord, type ZoneRecord } from './catalog.repository';

/** `getBootstrap` seçenekleri — çerezli istekte WebController/F6 JwtAuth doldurur; anonimde ikisi de null. */
export interface BootstrapOptions {
  me?: BootstrapMe | null;
  sub?: BootstrapSub | null;
}

/** Takvim gününün içinde bulunduğu haftanın Pazartesi'si (TZ'siz takvim aritmetiği; seed `thisWeekMonday` ile aynı). */
export function weekMondayOf(date: IsoDate): IsoDate {
  return addCalendarDays(date, -((weekdayOf(date) + 6) % 7));
}

/**
 * CatalogService — katalog iş kuralları (ADR-0002: mantık burada; WebController ve REST aynı servisi kullanır).
 *
 * `getBootstrap`: products.js şekline BİREBİR bootstrap yükü (BACKEND-PLANI §1.2, [B6][B21][B22]).
 * - Anonim kısım (me/sub null) DB'den kurulur ve 60 s in-process cache'te tutulur (CACHE_KEYS.bootstrapAnonymous);
 *   `me`/`sub` çağırandan gelir ve sığ kopyaya eklenir — cache'teki nesne asla değiştirilmez.
 * - SOLD_OUT / OUT_OF_SEASON / HIDDEN / DRAFT / silinmiş ürünler yüke girmez [B22].
 * - templates: aktif tier başına, weekStart ≤ bu haftanın Pazartesi'si olan en güncel PUBLISHED şablon;
 *   öğeleri görünür ürünlere süzülür, yoksa (ya da hepsi görünmezse) anahtar yazılmaz → cart.js eski davranış.
 * - deliveryDates: varsayılan bölge (urla) için bugünden itibaren 4 hafta; locked/full DB'deki kesim/kapasiteden.
 * - Zaman: `now` tek noktadan (`new Date()`) alınır ve aşağı geçirilir (ADR-0004; ham SQL yok).
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly repo: CatalogRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Bootstrap yükü — anonim kısım cache'li; `me`/`sub` parametreden (yoksa null). */
  async getBootstrap(opts?: BootstrapOptions): Promise<BootstrapPayload> {
    const base = await this.getAnonymousBootstrap();
    return { ...base, me: opts?.me ?? null, sub: opts?.sub ?? null };
  }

  /**
   * Admin mutasyonları (F4: ürün/parti/şablon/tier/ayar/kategori) sonrası çağrılır; sonraki istek DB'den kurar.
   * Kategori cache'i de birlikte düşer (F5: web sekmeleri/panel notları — kategori düzenlemesi anında sayfaya yansır).
   */
  async invalidateBootstrapCache(): Promise<void> {
    await Promise.all([this.cache.del(CACHE_KEYS.bootstrapAnonymous), this.cache.del(CACHE_KEYS.categoriesActive)]);
  }

  /**
   * Aktif kategoriler (slug/label/panelNote, sortOrder) — WebController index/urunler sekmeleri ve panel notları (F5).
   * 60 s in-process cache; CatalogAdminService kategori mutasyonlarında invalidateBootstrapCache ile düşer.
   */
  async listActiveCategories(): Promise<ActiveCategoryRecord[]> {
    const cached = await this.cache.get<ActiveCategoryRecord[]>(CACHE_KEYS.categoriesActive);
    if (cached) return cached;
    const rows = await this.repo.findActiveCategories();
    await this.cache.set(CACHE_KEYS.categoriesActive, rows, BOOTSTRAP_CACHE_TTL_MS);
    return rows;
  }

  /**
   * Anonim bootstrap'ı cache'siz, doğrudan DB'den kurar. `now` test edilebilirlik için parametre.
   * Normal akışta `getBootstrap` kullanılır; bu yöntem testler ve cache düşürme sonrası ilk kurulum içindir.
   */
  async buildBootstrap(now: Date = new Date()): Promise<BootstrapPayload> {
    const today = calendarDateIn(now, DEFAULT_TZ);
    const weekStart = isoDateToUtc(weekMondayOf(today));

    const [products, tiers, settingRows, zone, templateRows] = await Promise.all([
      this.repo.findActiveProducts({ visibleOnly: true }),
      this.repo.findActiveTiers(),
      this.repo.findSettingsByGroup(COMMERCE_SETTING_GROUP),
      this.resolveDefaultZone(),
      this.repo.findLatestPublishedTemplates(weekStart),
    ]);
    const dateRows = zone
      ? await this.repo.findDeliveryDates(
          zone.id,
          isoDateToUtc(today),
          isoDateToUtc(addCalendarDays(today, BOOTSTRAP_DELIVERY_WEEKS * 7)),
        )
      : [];

    const settings = mergeCommerceSettings(settingRows);
    const visibleSlugs = new Set(products.map((p) => p.slug));

    const templates: BootstrapTemplates = {};
    for (const t of templateRows) {
      const slugs = templateProductSlugs(t, visibleSlugs);
      if (slugs.length === 0) {
        this.logger.warn(`BoxTemplate ${t.id} (${t.tier.slug}) görünür ürün içermiyor — bootstrap.templates'e yazılmadı`);
        continue;
      }
      if (slugs.length < t.items.length) {
        this.logger.warn(`BoxTemplate ${t.id} (${t.tier.slug}): ${t.items.length - slugs.length} öğe bootstrap'ta görünmüyor, süzüldü`);
      }
      templates[t.tier.slug] = slugs;
    }

    const pairIds = products
      .filter((p) => p.pairWithBox)
      .sort((a, b) => a.pairOrder - b.pairOrder || a.sortOrder - b.sortOrder)
      .map((p) => p.slug);

    return {
      products: products.map(toBootstrapProduct),
      tiers: tiers.map(toSubTier),
      freqOptions: toFreqOptions(settings),
      deliveryDays: toDeliveryDayOptions(settings),
      deliveryFee: zone ? toMoney(zone.fee) : 0,
      me: null,
      sub: null,
      deliveryDates: dateRows.map((row) => toDeliveryDate(row, now)),
      templates,
      pool: products.filter((p) => p.isFresh).map((p) => p.slug),
      pairIds,
      recommendedTier: tiers.find((t) => t.isRecommended)?.slug ?? null,
      commerce: toBootstrapCommerce(settings, zone),
    };
  }

  // ── Public katalog uçları ──────────────────────────────────────────────────

  /** Yayındaki ürünler (tüm stok durumları; `stockStatus` DTO'da — istemci "tükendi" rozetini kendi basar). */
  async listProducts(): Promise<Product[]> {
    const rows = await this.repo.findActiveProducts({ visibleOnly: false });
    return rows.map(toProductDto);
  }

  async getProduct(slug: string): Promise<Product> {
    const row = await this.repo.findActiveProductBySlug(slug);
    if (!row) throw new NotFoundException(`Ürün bulunamadı: ${slug}`);
    return toProductDto(row);
  }

  async listTiers(): Promise<BoxTier[]> {
    const rows = await this.repo.findActiveTiers();
    return rows.map(toBoxTierDto);
  }

  /**
   * Tier'ın yayınlanmış şablonu: `week` (YYYY-MM-DD, haftanın herhangi bir günü) → o haftanın Pazartesi'si;
   * weekStart ≤ Pazartesi olan en güncel PUBLISHED şablon. `week` yoksa bu hafta (Europe/Istanbul).
   */
  async getTierTemplate(slug: string, week?: string): Promise<BoxTemplate> {
    const tier = await this.repo.findActiveTierBySlug(slug);
    if (!tier) throw new NotFoundException(`Kutu bulunamadı: ${slug}`);
    const weekStart = this.resolveWeekStart(week, new Date());
    const template = await this.repo.findLatestPublishedTemplate(tier.id, isoDateToUtc(weekStart));
    if (!template) throw new NotFoundException(`"${slug}" için ${weekStart} haftasında yayınlanmış şablon yok`);
    return toBoxTemplateDto(template);
  }

  async listProducers(): Promise<Producer[]> {
    const rows = await this.repo.findActiveProducers();
    return rows.map(toProducerDto);
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  private async getAnonymousBootstrap(): Promise<BootstrapPayload> {
    const cached = await this.cache.get<BootstrapPayload>(CACHE_KEYS.bootstrapAnonymous);
    if (cached) return cached;
    const built = await this.buildBootstrap(new Date());
    await this.cache.set(CACHE_KEYS.bootstrapAnonymous, built, BOOTSTRAP_CACHE_TTL_MS);
    return built;
  }

  /** Varsayılan bölge (urla); yoksa ilk aktif bölge (uyarı ile); hiç yoksa null → kargo 0, teslimat tarihi yok. */
  private async resolveDefaultZone(): Promise<ZoneRecord | null> {
    const zone = await this.repo.findActiveZoneBySlug(DEFAULT_ZONE_SLUG);
    if (zone) return zone;
    const fallback = await this.repo.findFirstActiveZone();
    if (fallback) {
      this.logger.warn(`Varsayılan bölge "${DEFAULT_ZONE_SLUG}" aktif değil — "${fallback.slug}" kullanılıyor`);
      return fallback;
    }
    this.logger.warn('Aktif teslimat bölgesi yok — bootstrap deliveryFee=0, deliveryDates=[]');
    return null;
  }

  /** `week` (YYYY-MM-DD) ya da bugün → takvimde geçerli mi (400) → haftanın Pazartesi'si. */
  private resolveWeekStart(week: string | undefined, now: Date): IsoDate {
    const base = week ?? calendarDateIn(now, DEFAULT_TZ);
    try {
      isoDateToUtc(base);
    } catch {
      throw new BadRequestException(`week takvimde olmayan bir gün: ${base}`);
    }
    return weekMondayOf(base);
  }
}
