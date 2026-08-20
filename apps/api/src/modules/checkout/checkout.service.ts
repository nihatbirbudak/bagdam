import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  BOOTSTRAP_VISIBLE_STOCK_STATUSES,
  deliveryDayFromSlug,
  FREQUENCY_WEEKS,
  resolveExtraOptions,
  type AddressSnapshot,
  type CheckoutQuoteResponse,
  type CheckoutRequiredConsent,
  type CheckoutResult,
  type ExtraOption,
  type IsoDate,
  type OrderLineBoxMetadata,
  type PaymentStatus,
  type PricingLineInput,
  type ProviderCheckoutInit,
} from '@bagdam/shared';
import { randomBytes } from 'crypto';
import { CouponsService } from '../coupons/coupons.service';
import { DeliveryDatesService } from '../delivery/delivery-dates.service';
import { webUrl } from '../mail/mail.constants';
import type { OrderRecord } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import type { PaymentRecord } from '../payments/payments.repository';
import { PaymentsService } from '../payments/payments.service';
import type { PaymentProvider } from '../payments/providers/payment-provider.interface';
import { PaymentProviderFactory } from '../payments/providers/payment-provider.factory';
import { ChargeStrategyResolver } from '../payments/charge/charge-strategy';
import { PricingService, type QuoteWithCoupon } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { CyclesService } from '../subscriptions/services/cycles.service';
import { SubscriptionsService } from '../subscriptions/services/subscriptions.service';
import { CHECKOUT_IN_PROGRESS_MINUTES, CheckoutCompletionService } from './checkout-completion.service';
import {
  requiredConsentsFrom,
  toBoxPricingLines,
  toCheckoutResult,
  toOrderSnapshotLines,
  toProductPricingLines,
  toQuoteResponse,
  type ResolvedBox,
  type ResolvedExtra,
  type ResolvedProductLine,
} from './checkout.mapper';
import {
  CheckoutRepository,
  type CheckoutAddressRecord,
  type CheckoutProductRecord,
  type CheckoutUserRecord,
  type DeliveryDateRecord,
  type Tx,
  type ZoneRecord,
} from './checkout.repository';
import type { CheckoutBoxDto, CheckoutConsentDto, CheckoutDto, CheckoutLineDto, CheckoutQuoteDto } from './dto/checkout.dto';

/** Varsayılan bölge (misafir quote, adres yok) — catalog DEFAULT_ZONE_SLUG ile aynı. */
const DEFAULT_ZONE_SLUG = 'urla';
/** Checkout onaylarının Consent.source değeri. */
const CHECKOUT_CONSENT_SOURCE = 'HS_CHECKOUT';
/** Payment.conversationId (PayTR merchant_oid, yalnız [A-Za-z0-9]): `ord<orderNo><4 rastgele>`. */
const CONVERSATION_RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface QuoteContext {
  userId: string | null;
  now?: Date;
}

export interface CheckoutContext {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}

/** Çözülmüş sepet: ürün satırları + kutu + fiyatlama girdisi. */
interface ResolvedCart {
  products: Map<string, ResolvedProductLine>;
  box: ResolvedBox | null;
  lines: PricingLineInput[];
  isSubscriptionCheckout: boolean;
}

function badRequest(error: string, message: string): BadRequestException {
  return new BadRequestException({ message, error });
}
function conflict(error: string, message: string, extra: Record<string, unknown> = {}): ConflictException {
  return new ConflictException({ message, error, ...extra });
}
function errorCodeOf(err: unknown): string | null {
  if (!(err instanceof HttpException)) return null;
  const body = err.getResponse();
  return typeof body === 'object' && body !== null ? ((body as { error?: string }).error ?? null) : null;
}

/** `ord<orderNo><4 rastgele>` — PayTR merchant_oid yalnız alfanümerik (A sözleşmesi). */
export function checkoutConversationIdFor(orderNo: number): string {
  const bytes = randomBytes(4);
  let rand = '';
  for (let i = 0; i < 4; i++) rand += CONVERSATION_RANDOM_ALPHABET[bytes[i]! % CONVERSATION_RANDOM_ALPHABET.length];
  return `ord${orderNo}${rand}`;
}

/**
 * CheckoutService — `POST /checkout/quote` (@Public) ve `POST /checkout` (oturumlu) (BACKEND-PLANI §3 checkout satırı; ADR-0003 istisna 1/3,
 * ADR-0006 cycle#1 peşin, ADR-0008 tek abonelik, ADR-0019 PayTR):
 *  quote:    bölge (zoneSlug → adres → urla) → sepet çöz (slug → ürün/tier/ekstra; fiyat KATALOGDAN) → PricingService.quoteWithCoupon →
 *            + bölge özeti + kupon durumu + zorunlu onay belgeleri.
 *  checkout: doğrula (kullanıcı/adres/teslimat günü/onaylar/kupon/kart) → TEK İŞLEM: eski ödenmemiş abonelik taslağı iptal →
 *            Subscription PENDING + cycle#1 (prepaid = kutu+ekstra−indirim, KARGO HARİÇ) → Order PENDING_PAYMENT (DD atomik rezerv; 409 DAY_FULL)
 *            → cycle#1.orderId → kupon kullanımı (bekleyen) → Consent satırları (orderId) → Payment PENDING (`ord<no><4>`)
 *            → İŞLEM DIŞI sağlayıcı: manual → anında SUCCEEDED (settle → PAID/ACTIVE) · saklı kart → chargeStoredCard (desteklenmiyorsa iFrame'e düşer)
 *            · PayTR → initCheckout → Payment REQUIRES_3DS + iFrame/redirect (callback A; sonuç CheckoutCompletionService).
 * Hata → işlem geri alınır (rezerv dahil); sağlayıcı init hatası → Payment FAILED + Order PAYMENT_FAILED + 503 PAYMENT_INIT_FAILED
 * (reconcile 24 s sonra iptal eder). Zaman `now` parametreyle (ADR-0004).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly repo: CheckoutRepository,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
    private readonly subscriptions: SubscriptionsService,
    private readonly cycles: CyclesService,
    private readonly deliveryDates: DeliveryDatesService,
    private readonly coupons: CouponsService,
    private readonly completion: CheckoutCompletionService,
    private readonly chargeStrategies: ChargeStrategyResolver,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /checkout/quote
  // ═══════════════════════════════════════════════════════════════════════════

  async quote(dto: CheckoutQuoteDto, ctx: QuoteContext): Promise<CheckoutQuoteResponse> {
    const zone = await this.resolveQuoteZone(dto.zoneSlug ?? null, ctx.userId);
    const cart = await this.resolveCart(dto, { strict: false });
    const q = await this.pricing.quoteWithCoupon(
      { lines: cart.lines, zoneId: zone.id, userId: ctx.userId, isSubscriptionCheckout: cart.isSubscriptionCheckout, couponCode: dto.couponCode ?? null, skipThisWeek: dto.skipThisWeek === true },
      { now: ctx.now },
    );
    const required = requiredConsentsFrom(await this.repo.findCurrentAckDocuments(), cart.isSubscriptionCheckout);
    return toQuoteResponse(q.quote, q.zone, q.coupon, required);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /checkout
  // ═══════════════════════════════════════════════════════════════════════════

  async checkout(dto: CheckoutDto, ctx: CheckoutContext): Promise<CheckoutResult> {
    const now = ctx.now ?? new Date();
    const commerce = await this.settings.getCommerce();

    // ── 1. kullanıcı / adres / bölge
    const user = await this.repo.findUserById(ctx.userId);
    if (!user || user.deletedAt || user.anonymizedAt || !user.isActive) throw new NotFoundException({ message: 'Kullanıcı bulunamadı', error: 'USER_NOT_FOUND' });
    const address = await this.repo.findAddressForUser(dto.addressId, user.id);
    if (!address) throw badRequest('ADDRESS_INVALID', 'Teslimat adresi bulunamadı');
    if (!address.phone.trim()) throw badRequest('ADDRESS_INVALID', 'Adreste telefon yok');
    const zone = await this.repo.findActiveZoneById(address.zoneId);
    if (!zone) throw badRequest('ZONE_INVALID', 'Adresin bölgesi hizmet dışı');

    // ── 2. sepet
    const cart = await this.resolveCart(dto, { strict: true });
    if (cart.lines.length === 0) throw badRequest('CHECKOUT_EMPTY', 'Sepet boş');
    const box = cart.box;
    const isSubscription = cart.isSubscriptionCheckout;
    if (box && !box.isOneTime && !commerce.frequencies.some((f) => f.weeks === box.frequencyWeeks)) {
      throw badRequest('FREQUENCY_INVALID', 'Abonelik sıklığı geçersiz');
    }

    // ── 3. teslimat günü
    const dd = await this.resolveDeliveryDate(dto, address, now);
    if (box) {
      const wantedDay = dto.box?.deliveryDay ? deliveryDayFromSlug(dto.box.deliveryDay) : null;
      if (dto.box?.deliveryDay && !wantedDay) throw badRequest('DELIVERY_DAY_INVALID', 'Teslimat günü geçersiz');
      if (wantedDay && wantedDay !== dd.day) throw badRequest('DELIVERY_DAY_MISMATCH', 'Seçilen teslimat tarihi kutunun teslimat günüyle uyuşmuyor');
    }

    // ── 4. onaylar (requiresAck belgeler; abonelikte sözleşme)
    const required = requiredConsentsFrom(await this.repo.findCurrentAckDocuments(), isSubscription);
    const consentDocIds = this.validateConsents(dto.consents, required, await this.repo.findCurrentAckDocuments());

    // ── 5. fiyat (kupon dahil) — tek kaynak PricingService
    const q = await this.pricing.quoteWithCoupon(
      { lines: cart.lines, zoneId: zone.id, userId: user.id, isSubscriptionCheckout: isSubscription, couponCode: dto.couponCode ?? null },
      { now },
    );
    if (dto.couponCode && (!q.coupon || !q.coupon.valid)) {
      throw badRequest('COUPON_INVALID', q.coupon?.message ?? 'Kupon geçersiz');
    }
    if (!(q.quote.grandTotal >= 0)) throw badRequest('CHECKOUT_EMPTY', 'Tutar hesaplanamadı');

    // ── 6. sağlayıcı + saklı kart
    const provider = await this.providers.getActive();
    await this.assertPaymentsEnabled(provider);
    const storedCard = dto.paymentMethodId ? await this.payments.findPaymentMethod(dto.paymentMethodId) : null;
    if (dto.paymentMethodId) {
      if (!storedCard || storedCard.userId !== user.id || !storedCard.isActive || storedCard.deletedAt) throw badRequest('PAYMENT_METHOD_INVALID', 'Kart geçersiz');
      if (storedCard.provider !== provider.enumValue) throw badRequest('PAYMENT_METHOD_INVALID', 'Kart bu ödeme sağlayıcısına ait değil');
    }

    // ── 7. tek işlem: taslak temizliği → Subscription+cycle#1 → Order → bağ → kupon → onaylar → Payment PENDING
    const addressSnapshot: AddressSnapshot = { fullName: address.fullName, phone: address.phone, line: address.line, zoneId: address.zoneId, zoneName: address.zone.name, zip: address.zip };
    const customer = { name: address.fullName.trim() || user.name?.trim() || user.email, email: user.email, phone: address.phone };
    // Abonelik tahsilat stratejisi: Setting commerce.chargeStrategy; PayTR kayıtlı kart onayı (payment.storedCardEnabled) yoksa PAYMENT_LINK (ADR-0019, A notu)
    const chargeStrategy = box && !box.isOneTime ? (await this.chargeStrategies.resolveDefault()).kind : undefined;
    const created = await this.repo.transaction(async (tx) => {
      if (box) await this.cleanupPendingSubscription(user.id, now, tx);

      let subscriptionId: string | null = null;
      let cycleId: string | null = null;
      let boxItems: OrderLineBoxMetadata['items'] = [];
      if (box) {
        const { subscription, cycle } = await this.subscriptions.createFromCheckout(
          { id: user.id },
          {
            tierSlug: box.tier.slug,
            frequencyWeeks: box.frequencyWeeks,
            deliveryDay: dd.day,
            zoneId: zone.id,
            addressId: address.id,
            paymentMethodId: storedCard?.id ?? null,
            isOneTime: box.isOneTime,
            chargeStrategy,
            itemPrefs: box.itemPrefs,
            deliveryDateId: dd.id,
            orderId: null,
            prepaidAmount: q.base.prepaidAmount ?? 0, // KARAR: kutu + ekstralar − indirim, kargo HARİÇ (kuponsuz — motor tutarlılığı)
            items: box.items.length > 0 ? box.items : undefined,
            extras: box.extras.map((e) => ({ id: e.product.slug, factor: e.factor, label: e.label })),
            contractDocId: consentDocIds.get('SUBSCRIPTION_CONTRACT_ACK') ?? null,
            now,
          },
          tx,
        );
        subscriptionId = subscription.id;
        cycleId = cycle.id;
        boxItems = cycle.items
          .filter((i) => i.source === 'TEMPLATE' || i.source === 'SWAP')
          .map((i) => ({ productId: i.productId, slug: i.product.slug, name: i.product.name, pref: i.pref, boxAmount: i.label ?? i.product.boxAmount ?? null, lotCode: i.lotCode ?? i.lot?.lotCode ?? null }));
      }

      const { order } = await this.orders.createFromQuote(
        {
          quote: q.quote,
          lines: toOrderSnapshotLines(q.quote, cart.products, box, boxItems),
          kind: q.quote.orderKind,
          userId: user.id,
          subscriptionId,
          customer,
          address: addressSnapshot,
          deliveryDateId: dd.id,
          couponCode: q.coupon?.valid ? q.coupon.code : null,
          note: dto.note ?? null,
          ipAddress: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          now,
        },
        tx,
      );
      if (cycleId) await this.repo.linkCycleOrder(cycleId, order.id, tx);
      if (q.coupon?.valid && q.coupon.couponId) {
        await this.coupons.reserveRedemption({ couponId: q.coupon.couponId, orderId: order.id, userId: user.id, amount: q.coupon.discount }, tx);
      }
      await this.repo.createConsents(
        dto.consents
          .filter((c) => required.some((r) => r.kind === c.kind))
          .map((c) => ({
            userId: user.id,
            orderId: order.id,
            kind: c.kind,
            documentId: consentDocIds.get(c.kind)!,
            source: CHECKOUT_CONSENT_SOURCE,
            ipAddress: ctx.ip ? ctx.ip.slice(0, 64) : null,
            userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
          })),
        tx,
      );
      const payment = await this.payments.recordPayment(
        {
          orderId: order.id,
          provider: provider.enumValue,
          kind: 'CHECKOUT',
          conversationId: checkoutConversationIdFor(order.orderNo),
          amount: q.quote.grandTotal,
          paymentMethodId: storedCard?.id ?? null,
          is3ds: !storedCard,
          isMerchantInitiated: false,
        },
        tx,
      );
      return { order, payment, subscriptionId };
    });
    this.logger.log(`Checkout: sipariş #${created.order.orderNo} (${created.order.kind}, ${q.quote.grandTotal} TL, ${provider.name}${created.subscriptionId ? `, sub ${created.subscriptionId}` : ''})`);

    // ── 8. sağlayıcı (işlem dışı)
    return this.startPayment(created.order, created.payment, provider, q, {
      user,
      storedCard: storedCard ? { id: storedCard.id, providerCustomerKey: storedCard.providerCustomerKey, providerCardToken: storedCard.providerCardToken, last4: storedCard.last4 } : null,
      saveCard: dto.saveCard ?? isSubscription,
      ip: ctx.ip ?? null,
      now,
    });
  }

  // ── Sağlayıcı adımı ───────────────────────────────────────────────────────────

  private async startPayment(
    order: OrderRecord,
    payment: PaymentRecord,
    provider: PaymentProvider,
    q: QuoteWithCoupon,
    opts: { user: CheckoutUserRecord; storedCard: { id: string; providerCustomerKey: string; providerCardToken: string; last4: string } | null; saveCard: boolean; ip: string | null; now: Date },
  ): Promise<CheckoutResult> {
    const amount = q.quote.grandTotal;
    const baseResult = (status: string, paymentStatus: PaymentStatus, init: Partial<ProviderCheckoutInit> = {}) =>
      toCheckoutResult({
        orderNo: order.orderNo,
        orderId: order.id,
        status: status as CheckoutResult['status'],
        subscriptionId: order.subscriptionId,
        grandTotal: amount,
        notes: q.quote.notes,
        payment: {
          id: payment.id,
          provider: payment.provider,
          providerName: provider.name,
          status: paymentStatus,
          token: init.providerToken ?? null,
          checkoutFormContent: init.checkoutFormContent ?? null,
          redirectUrl: init.redirectUrl ?? null,
          conversationId: payment.conversationId,
        },
      });

    // a) Manuel sağlayıcı (geliştirme/test; ADR-0010): anında SUCCEEDED → PAID (+ abonelik ACTIVE)
    if (provider.name === 'manual') {
      const init = await provider.initCheckout(this.providerOrder(order, amount, opts.user), { conversationId: payment.conversationId, callbackUrl: this.callbackUrl(provider), saveCard: opts.saveCard, ip: opts.ip });
      const settled = await this.payments.settlePayment(payment, { status: 'SUCCEEDED', providerPaymentId: `man_${order.orderNo}`, rawResponse: { provider: 'manual', token: init.providerToken }, paidAt: opts.now, actor: 'USER' });
      return baseResult(settled.outcome?.orderStatus ?? 'PAID', settled.payment.status, init);
    }

    // b) Saklı kart: sağlayıcıdan doğrudan tahsilat (desteklenmiyorsa iFrame'e düş)
    if (opts.storedCard) {
      try {
        const res = await provider.chargeStoredCard(opts.storedCard, amount, payment.conversationId);
        if (res.ok) {
          const settled = await this.payments.settlePayment(payment, { status: 'SUCCEEDED', providerPaymentId: res.providerPaymentId, rawResponse: res.raw, paidAt: opts.now, actor: 'USER' });
          return baseResult(settled.outcome?.orderStatus ?? 'PAID', settled.payment.status);
        }
        const settled = await this.payments.settlePayment(payment, { status: 'FAILED', failureCode: res.failureCode ?? 'PROVIDER_DECLINED', failureMessage: res.failureMessage, rawResponse: res.raw, actor: 'USER' });
        return baseResult(settled.outcome?.orderStatus ?? 'PAYMENT_FAILED', settled.payment.status);
      } catch (err) {
        if (errorCodeOf(err) !== 'PROVIDER_FEATURE_DISABLED') throw err;
        this.logger.warn(`Saklı karttan tahsilat sağlayıcıda kapalı (${provider.name}) → iFrame akışı (#${order.orderNo})`);
      }
    }

    // c) iFrame / yönlendirme (PayTR): token → Payment REQUIRES_3DS; sonuç callback'te
    let init: ProviderCheckoutInit;
    try {
      init = await provider.initCheckout(this.providerOrder(order, amount, opts.user), {
        conversationId: payment.conversationId,
        callbackUrl: this.callbackUrl(provider),
        saveCard: opts.saveCard,
        customerKey: opts.storedCard?.providerCustomerKey ?? null,
        ip: opts.ip,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ödeme başlatılamadı (#${order.orderNo}, ${provider.name}): ${message}`);
      await this.payments.settlePayment(payment, { status: 'FAILED', failureCode: 'PROVIDER_INIT_FAILED', failureMessage: message.slice(0, 255), actor: 'SYSTEM' }).catch(() => undefined);
      throw new ServiceUnavailableException({ message: `Ödeme başlatılamadı (#${order.orderNo}), lütfen biraz sonra tekrar dene`, error: 'PAYMENT_INIT_FAILED', orderNo: order.orderNo });
    }
    const pending = await this.payments.markRequires3ds(payment.id, init.providerToken);
    return baseResult(order.status, pending.status, init);
  }

  private providerOrder(order: OrderRecord, amount: number, user: CheckoutUserRecord) {
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      amount,
      customer: { id: user.id, email: order.customerEmail, name: order.customerName, phone: order.customerPhone },
      description: `Bağdam sipariş #${order.orderNo}`,
    };
  }

  private callbackUrl(provider: PaymentProvider): string {
    return `${webUrl() || 'http://127.0.0.1:4010'}/api/v1/payments/${provider.name}/callback`;
  }

  private async assertPaymentsEnabled(provider: PaymentProvider): Promise<void> {
    if (provider.name === 'manual') return;
    const payment = (await this.settings.get('payment')) as { enabled?: unknown };
    if (payment.enabled === false) {
      throw new ServiceUnavailableException({ message: 'Ödeme alma şu anda kapalı; lütfen daha sonra tekrar dene', error: 'PAYMENTS_DISABLED' });
    }
  }

  // ── Doğrulama / çözümleme ─────────────────────────────────────────────────────

  /** Bölge: zoneSlug → oturumlu kullanıcının varsayılan adresi → `urla` → ilk aktif bölge. */
  private async resolveQuoteZone(zoneSlug: string | null, userId: string | null): Promise<ZoneRecord> {
    if (zoneSlug) {
      const zone = await this.repo.findActiveZoneBySlug(zoneSlug);
      if (!zone) throw badRequest('ZONE_INVALID', 'Geçersiz ya da hizmet dışı teslimat bölgesi');
      return zone;
    }
    if (userId) {
      const address = await this.repo.findDefaultAddressForUser(userId);
      if (address?.zone.isActive) return address.zone;
    }
    const zone = (await this.repo.findActiveZoneBySlug(DEFAULT_ZONE_SLUG)) ?? (await this.repo.findFirstActiveZone());
    if (!zone) throw badRequest('ZONE_INVALID', 'Aktif teslimat bölgesi yok');
    return zone;
  }

  /** Sepet satırları + kutu → ürün/tier/ekstra kayıtları (satın alınabilirlik: ACTIVE, silinmemiş, IN_STOCK|LOW). */
  private async resolveCart(dto: CheckoutQuoteDto, opts: { strict: boolean }): Promise<ResolvedCart> {
    const lineDtos = dto.lines ?? [];
    const boxDto = dto.box ?? null;
    const slugs = new Set<string>([...lineDtos.map((l) => l.id), ...(boxDto?.extras ?? []).map((e) => e.id)]);
    const productRows = await this.repo.findProductsBySlugs([...slugs]);
    const bySlug = new Map(productRows.map((p) => [p.slug, p]));
    const commerce = await this.settings.getCommerce();

    // Aynı ürün + tercih birleştirilir (adet toplanır)
    const products = new Map<string, ResolvedProductLine>();
    for (const line of lineDtos) {
      const product = bySlug.get(line.id);
      if (!product || !isPurchasable(product)) throw badRequest('PRODUCT_NOT_AVAILABLE', `Ürün şu anda alınamıyor: ${line.id}`);
      const pref = this.resolvePref(product, line.pref ?? null);
      const key = `${product.id}|${pref ?? ''}`;
      const existing = products.get(key);
      if (existing) existing.qty += line.qty;
      else products.set(key, { product, qty: line.qty, pref });
    }

    let box: ResolvedBox | null = null;
    if (boxDto) {
      const tier = await this.repo.findTierBySlug(boxDto.tier);
      if (!tier || !tier.isActive) throw badRequest('TIER_INVALID', 'Kutu boyu geçersiz');
      const extras: ResolvedExtra[] = (boxDto.extras ?? []).map((e) => {
        const product = bySlug.get(e.id);
        if (!product || !isPurchasable(product)) throw badRequest('PRODUCT_NOT_AVAILABLE', `Ekstra ürün alınamaz: ${e.id}`);
        const options = resolveExtraOptions(product.unit, commerce, product.extraOptions as ExtraOption[] | null);
        const option = options.find((o) => Math.abs(o.factor - e.factor) < 1e-9);
        if (!option) throw badRequest('EXTRA_FACTOR_INVALID', `Ekstra miktarı geçersiz: ${e.id} × ${e.factor}`);
        return { product, factor: e.factor, label: e.label ?? option.label };
      });
      const isOneTime = boxDto.isOneTime === true;
      const frequencyWeeks = isOneTime ? 1 : (boxDto.frequencyWeeks ?? (boxDto.freq ? FREQUENCY_WEEKS[boxDto.freq] : 1));
      box = { tier, items: [...new Set(boxDto.items ?? [])], itemPrefs: this.validateItemPrefs(boxDto.itemPrefs), extras, isOneTime, frequencyWeeks };
    }

    const lines: PricingLineInput[] = [...(box ? toBoxPricingLines(box) : []), ...toProductPricingLines([...products.values()])];
    if (opts.strict && lines.length === 0) throw badRequest('CHECKOUT_EMPTY', 'Sepet boş');
    return { products, box, lines, isSubscriptionCheckout: box !== null && !box.isOneTime };
  }

  private resolvePref(product: CheckoutProductRecord, pref: string | null): string | null {
    // prefDefault = prefOptions içindeki varsayılan seçeneğin indeksi (cart.js / cycles.defaultPref ile aynı kural)
    if (pref === null || pref === '') return product.prefOptions.length > 0 ? (product.prefOptions[product.prefDefault ?? 0] ?? null) : null;
    if (product.prefOptions.length > 0 && !product.prefOptions.includes(pref)) {
      throw badRequest('PREF_INVALID', `Tercih seçeneği geçersiz: ${product.slug} → ${pref}`);
    }
    return pref;
  }

  private validateItemPrefs(prefs: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [slug, value] of Object.entries(prefs ?? {})) {
      if (typeof value !== 'string' || value.length > 60) throw badRequest('PREF_INVALID', `Tercih geçersiz: ${slug}`);
      if (value !== '') out[slug] = value;
    }
    return out;
  }

  /** deliveryDateId ya da deliveryOn (adres bölgesi) → DeliveryDate; kilitli/kapalı 409 DAY_LOCKED, dolu 409 DAY_FULL (ön kontrol; rezerv atomik). */
  private async resolveDeliveryDate(dto: CheckoutDto, address: CheckoutAddressRecord, now: Date): Promise<DeliveryDateRecord> {
    let dd: DeliveryDateRecord | null = null;
    if (dto.deliveryDateId) {
      dd = await this.repo.findDeliveryDateById(dto.deliveryDateId);
      if (!dd) throw badRequest('DELIVERY_DATE_INVALID', 'Teslimat günü bulunamadı');
    } else if (dto.deliveryOn) {
      try {
        dd = await this.deliveryDates.findOrCreateFor(address.zoneId, dto.deliveryOn as IsoDate);
      } catch (err) {
        const code = errorCodeOf(err);
        if (code === 'NOT_DELIVERY_DAY' || code === 'INVALID_DATE') throw badRequest('DELIVERY_DATE_INVALID', 'Seçilen gün teslimat günü değil');
        throw err;
      }
    } else {
      throw badRequest('DELIVERY_DATE_REQUIRED', 'Teslimat günü seç (deliveryDateId ya da deliveryOn)');
    }
    if (dd.zoneId !== address.zoneId) throw badRequest('ZONE_MISMATCH', 'Teslimat günü adresin bölgesine ait değil');
    if (this.deliveryDates.isLocked(dd, now)) throw conflict('DAY_LOCKED', 'Bu teslimat günü için sipariş kesimi geçti ya da gün kapalı');
    if (this.deliveryDates.isFull(dd)) throw conflict('DAY_FULL', 'Seçilen teslimat günü dolu; lütfen başka bir gün seç');
    return dd;
  }

  /**
   * Onaylar: her zorunlu belge için aynı slug + YAYINDAKİ sürüm gönderilmiş olmalı → documentId. Eksik → 400 CONSENT_REQUIRED (missing[]);
   * eski sürüm → 400 CONSENT_DOCUMENT_OUTDATED; slug/tür uyuşmazlığı → 400 CONSENT_DOCUMENT_INVALID.
   */
  private validateConsents(given: readonly CheckoutConsentDto[], required: readonly CheckoutRequiredConsent[], docs: readonly { id: string; slug: string; version: number }[]): Map<string, string> {
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const req of required) {
      const match = given.find((g) => g.kind === req.kind);
      if (!match) {
        missing.push(req.kind);
        continue;
      }
      if (match.documentSlug !== req.documentSlug) {
        throw badRequest('CONSENT_DOCUMENT_INVALID', `${req.kind} onayı ${req.documentSlug} belgesine verilmeli`);
      }
      if (match.version !== req.version) {
        throw new BadRequestException({ message: `Onayladığın belge güncellenmiş (${req.documentSlug} v${req.version}); lütfen yeni sürümü onayla`, error: 'CONSENT_DOCUMENT_OUTDATED', documentSlug: req.documentSlug, currentVersion: req.version });
      }
      const doc = docs.find((d) => d.slug === req.documentSlug && d.version === req.version);
      if (!doc) throw badRequest('CONSENT_DOCUMENT_INVALID', `Belge bulunamadı: ${req.documentSlug} v${req.version}`);
      out.set(req.kind, doc.id);
    }
    if (missing.length > 0) {
      // Not: hata zarfı yalnız message/error taşır — eksik türler mesajın sonunda (istemci ayrıştırabilir)
      throw new BadRequestException({ message: `Sipariş için gerekli onaylar eksik: ${missing.join(', ')}`, error: 'CONSENT_REQUIRED', missing });
    }
    return out;
  }

  /**
   * Tek aktif abonelik (ADR-0008, PENDING dahil): kullanıcının ödenmemiş checkout taslağı (PENDING abonelik) varsa —
   * açık ödemesi < CHECKOUT_IN_PROGRESS_MINUTES ise 409 CHECKOUT_IN_PROGRESS (orderNo ile: istemci durumu sorar);
   * değilse (eski/başarısız) taslak iptal edilir (cycle#1 CANCELLED + DD iade + Order CANCELLED + Payment EXPIRED) ve yeni checkout sürer.
   */
  private async cleanupPendingSubscription(userId: string, now: Date, tx: Tx): Promise<void> {
    const pending = await this.repo.findPendingSubscriptionForUser(userId, tx);
    if (!pending) return;
    const orderId = pending.cycles[0]?.orderId ?? null;
    const order = orderId ? await this.orders.findRecord(orderId, tx) : null;
    if (order) {
      if (order.status === 'PAID') return; // ödenmiş ama henüz aktifleşmemiş (callback yolda) → createFromCheckout 409 SUBSCRIPTION_EXISTS verir
      const open = order.payments.find((p) => p.status === 'PENDING' || p.status === 'REQUIRES_3DS');
      if (open && now.getTime() - open.createdAt.getTime() < CHECKOUT_IN_PROGRESS_MINUTES * MINUTE_MS) {
        throw conflict('CHECKOUT_IN_PROGRESS', `Devam eden bir ödemen var (#${order.orderNo}); tamamla ya da birkaç dakika sonra tekrar dene`, { orderNo: order.orderNo });
      }
      await this.completion.abandonOrder(order, 'Yeni checkout — ödenmemiş eski taslak iptal edildi', now, tx);
      return;
    }
    // Order bağlı değil (yarım kalmış taslak): aboneliği kapat (cycle#1 CANCELLED + DD iade)
    await this.cycles.cancelSubscription(pending.id, { actor: 'SYSTEM', reason: 'Yeni checkout — yarım kalmış taslak', requestedAt: now }, now, tx);
  }
}

const MINUTE_MS = 60_000;

function isPurchasable(product: CheckoutProductRecord): boolean {
  return product.deletedAt === null && product.status === 'ACTIVE' && (BOOTSTRAP_VISIBLE_STOCK_STATUSES as readonly string[]).includes(product.stockStatus);
}

