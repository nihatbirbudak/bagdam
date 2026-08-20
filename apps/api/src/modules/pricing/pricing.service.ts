import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeCycleCharge,
  computeQuote,
  isCycleChargeByIdRequest,
  type CommerceSettings,
  type CycleChargeExplicitRequest,
  type CycleChargeQuote,
  type CycleChargeRequest,
  type PricingContext,
  type PricingResult,
  type QuoteInput,
  type QuoteUserContext,
  type ZoneShippingRule,
} from '@bagdam/shared';
import { SettingsService } from '../settings/settings.service';
import { decimalToMoney, NO_SHIPPING_ZONE, toZoneShippingRule } from './pricing.mapper';
import { PricingRepository, type CycleChargeRecord, type ZoneRecord } from './pricing.repository';

/** Cycle öğelerinden tahsilata giren kaynaklar (state-machines §8 adım 2: EXTRA + CART_MERGE). */
const CHARGEABLE_ITEM_SOURCES = new Set<string>(['EXTRA', 'CART_MERGE']);

/**
 * PricingService — fiyatlamanın TEK giriş noktası (BACKEND-PLANI §0 md.10, §5 F7; ADR-0005/0006/0007/0018).
 * Hesap `@bagdam/shared/pricing` saf fonksiyonlarında (computeQuote / computeCycleCharge); bu servis yalnız gerçekleri çözer:
 *  - Setting `commerce.*` → kurallar (freeShippingRule / discountRounding / subscriberFreeShipping), vatRate, firstBoxDiscount.pct/boxes;
 *  - DeliveryZone → kargo ücreti / ücretsiz eşik (TEK sahip, ADR-0005 [B11]);
 *  - kullanıcı bağlamı → hasActiveSubscription (canlı abonelik), firstBoxesLeft (`User.firstBoxesPromoUsedAt` / Setting boxes; misafir hak var sayılır),
 *    retentionPct (yeni checkout'ta null); çağıran `QuoteInput.context` ile kısmen ezebilir.
 *  - `couponCode` F8'de (kupon sistemi kararı açık; şimdilik yok sayılır, log).
 * `cycleCharge`: `{cycleId}` → cycle + abonelik + tier + bölge + EXTRA/CART_MERGE öğeleri DB'den; ya da açık biçim (test/önizleme).
 * Hiçbir yazma yapmaz; zaman parametresi yok (fiyatlama "şimdi" bağımsızdır; kesim kararı çağıranın).
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly repo: PricingRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Sepet/sipariş fiyat özeti — checkout quote ve Order snapshot'ının kaynağı. */
  async quote(input: QuoteInput): Promise<PricingResult> {
    const commerce = await this.settings.getCommerce();
    const zone = await this.resolveZone(input.zoneId, input.zoneSlug);
    const user = await this.resolveUserContext(input.userId, commerce, input.context);
    if (input.couponCode) {
      // F8: kupon uygulaması (Coupon/CouponRedemption) — şimdilik fiyatı etkilemez
      this.logger.debug(`quote: couponCode yok sayıldı (F8): ${input.couponCode}`);
    }
    const ctx: PricingContext = {
      zone: toZoneShippingRule(zone),
      hasActiveSubscription: user.hasActiveSubscription,
      isSubscriptionCheckout: input.isSubscriptionCheckout,
      firstBoxesLeft: user.firstBoxesLeft,
      retentionPct: user.retentionPct,
      vatRateDefault: commerce.vatRate,
      firstBoxPct: commerce.firstBoxDiscount.pct,
      skipThisWeek: input.skipThisWeek === true,
      rules: commerce,
    };
    return computeQuote(input.lines, ctx);
  }

  /**
   * Cycle kilit anı snapshot'ı (state-machines §8 adım 2–3): boxPrice (tier'ın kilit anındaki fiyatı) · extrasTotal ·
   * discount (ilk-kutu ?: retention; tek seferlikte yok) · shippingFee (abonelik 0 / tek seferlik bölge kuralı) · total · due = total − prepaid.
   */
  async cycleCharge(input: CycleChargeRequest): Promise<CycleChargeQuote> {
    const commerce = await this.settings.getCommerce();
    if (isCycleChargeByIdRequest(input)) {
      const cycle = await this.repo.findCycleForCharge(input.cycleId);
      if (!cycle) throw new NotFoundException({ message: `Cycle bulunamadı: ${input.cycleId}`, error: 'CYCLE_NOT_FOUND' });
      return this.computeFromCycle(cycle, commerce);
    }
    return this.computeExplicit(input, commerce);
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────────────────────────────────────────────

  private computeFromCycle(cycle: CycleChargeRecord, commerce: CommerceSettings): CycleChargeQuote {
    const sub = cycle.subscription;
    const extras = cycle.items
      .filter((item) => CHARGEABLE_ITEM_SOURCES.has(item.source))
      .map((item) => ({
        // Kilit sonrası snapshot varsa o (unitPrice), yoksa ürünün güncel fiyatı
        unitPrice: item.unitPrice !== null ? decimalToMoney(item.unitPrice) : decimalToMoney(item.product.price),
        factor: Number(item.qty.toString()),
      }));
    return computeCycleCharge({
      boxPrice: decimalToMoney(sub.tier.price),
      extras,
      isOneTime: sub.isOneTime,
      zone: toZoneShippingRule(sub.zone),
      firstBoxesLeft: sub.discountBoxesLeft,
      retentionPct: sub.nextBoxDiscountPct,
      firstBoxPct: commerce.firstBoxDiscount.pct,
      prepaidAmount: decimalToMoney(cycle.prepaidAmount),
      rules: commerce,
    });
  }

  private async computeExplicit(input: CycleChargeExplicitRequest, commerce: CommerceSettings): Promise<CycleChargeQuote> {
    let zone: ZoneShippingRule;
    if (input.zone) zone = input.zone;
    else if (input.zoneId || input.zoneSlug) zone = toZoneShippingRule(await this.resolveZone(input.zoneId, input.zoneSlug, { allowInactive: true }));
    else if (input.isOneTime) {
      throw new BadRequestException({ message: 'Tek seferlik kutu için bölge gerekli (zone ya da zoneId/zoneSlug)', error: 'ZONE_REQUIRED' });
    } else zone = NO_SHIPPING_ZONE; // abonelik: kargo her zaman 0
    return computeCycleCharge({
      boxPrice: input.boxPrice,
      extras: input.extras,
      isOneTime: input.isOneTime,
      zone,
      firstBoxesLeft: input.firstBoxesLeft,
      retentionPct: input.retentionPct,
      firstBoxPct: commerce.firstBoxDiscount.pct,
      prepaidAmount: input.prepaidAmount,
      rules: commerce,
    });
  }

  /** zoneId ya da zoneSlug → bölge (varsayılan: yalnız aktif; checkout'ta pasif bölgeye sipariş verilemez). */
  private async resolveZone(
    zoneId: string | null | undefined,
    zoneSlug: string | null | undefined,
    opts: { allowInactive?: boolean } = {},
  ): Promise<ZoneRecord> {
    if (!zoneId && !zoneSlug) {
      throw new BadRequestException({ message: 'Teslimat bölgesi gerekli (zoneId ya da zoneSlug)', error: 'ZONE_REQUIRED' });
    }
    const zone = opts.allowInactive
      ? zoneId
        ? await this.repo.findZoneById(zoneId)
        : await this.repo.findZoneBySlug(zoneSlug!)
      : zoneId
        ? await this.repo.findActiveZoneById(zoneId)
        : await this.repo.findActiveZoneBySlug(zoneSlug!);
    if (!zone) {
      throw new BadRequestException({ message: 'Geçersiz ya da hizmet dışı teslimat bölgesi', error: 'ZONE_INVALID' });
    }
    return zone;
  }

  /**
   * Kullanıcı bağlamı: misafir → abone değil, ilk-kutu hakkı var sayılır (prototip: her abonelikte %50 gösterilir), retention yok.
   * Üye → canlı abonelik var mı; `firstBoxesPromoUsedAt` doluysa (ve perUserOnce) hak 0; retention yeni checkout'ta null.
   * `override` verilen alanları ezer (abonelik modülü kendi kaydını bilir).
   */
  private async resolveUserContext(
    userId: string | null | undefined,
    commerce: CommerceSettings,
    override: Partial<QuoteUserContext> | undefined,
  ): Promise<QuoteUserContext> {
    const boxes = commerce.firstBoxDiscount.boxes;
    const resolved: QuoteUserContext = { hasActiveSubscription: false, firstBoxesLeft: boxes, retentionPct: null };
    if (userId) {
      const [user, live] = await Promise.all([this.repo.findUserPromoState(userId), this.repo.findLiveSubscription(userId)]);
      if (!user) this.logger.warn(`quote: kullanıcı bulunamadı, misafir bağlamı kullanıldı (${userId})`);
      resolved.hasActiveSubscription = live !== null;
      resolved.firstBoxesLeft = user && user.firstBoxesPromoUsedAt && commerce.firstBoxDiscount.perUserOnce ? 0 : boxes;
    }
    return {
      hasActiveSubscription: override?.hasActiveSubscription ?? resolved.hasActiveSubscription,
      firstBoxesLeft: override?.firstBoxesLeft ?? resolved.firstBoxesLeft,
      retentionPct: override?.retentionPct !== undefined ? override.retentionPct : resolved.retentionPct,
    };
  }
}
