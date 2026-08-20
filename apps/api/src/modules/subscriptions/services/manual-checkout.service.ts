import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  deliveryDayToSlug,
  OrderKind,
  OrderLineKind,
  resolveExtraOptions,
  utcToIsoDate,
  type AddressSnapshot,
  type AdminCreateSubscriptionResult,
  type ExtraOption,
  type IsoDate,
  type OrderLineBoxMetadata,
  type OrderLineSnapshotInput,
  type PricingLineInput,
  type PricingResult,
} from '@bagdam/shared';
import { DeliveryDatesService } from '../../delivery/delivery-dates.service';
import { OrdersService } from '../../orders/orders.service';
import { checkoutConversationId } from '../../payments/payments.constants';
import { PaymentsService } from '../../payments/payments.service';
import { PricingService } from '../../pricing/pricing.service';
import { SettingsService } from '../../settings/settings.service';
import type { AdminCreateSubscriptionDto } from '../dto/admin-subscription.dto';
import { ACTOR } from '../subscriptions.constants';
import { SUB_ERRORS, conflict } from '../subscriptions.errors';
import { isBoxItem, money, toCycleDto } from '../subscriptions.mapper';
import { SubscriptionsRepository, type CycleRecord, type ProductRecord } from '../subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';

export interface ManualCheckoutContext {
  /** İşlemi yapan admin (audit / SubscriptionEvent). */
  adminId: string | null;
  now?: Date;
}

/**
 * ManualCheckoutService — admin `POST /admin/subscriptions`: ofis/havale/nakit siparişi (F8 checkout'un sunucu tarafı
 * iskeleti — aynı orkestrasyon, ödeme sağlayıcısı yerine MANUAL ödeme). Tek işlemde:
 *  1. doğrula: müşteri (aktif, anonim değil) · tier · adres (müşterinin; yoksa varsayılan) · kart (müşterinin) · sıklık/gün Setting'e uygun
 *  2. teslimat günü: `deliveryOn` ya da bölge+gün için kesimi geçmemiş ilk tarih (DeliveryDatesService.findOrCreateFor / nextFor)
 *  3. fiyat: PricingService.quote (BOX + EXTRA satırları; ilk-kutu indirimi, kargo kuralı; kupon yok)
 *  4. Subscription PENDING + cycle#1 (SubscriptionsService.createFromCheckout; içerik = seçilen ürünler ya da haftanın şablonu)
 *  5. Order PENDING_PAYMENT (OrdersService.createFromQuote — DeliveryDate atomik rezerv, snapshot) → cycle#1.orderId
 *  6. Payment MANUAL/CHECKOUT `chk_<orderId>` SUCCEEDED → Order PAID (actor ADMIN)
 *  7. Subscription ACTIVE (activate: startedAt, ilk-kutu sayacı, cycles:ensure) + SubscriptionEvent ADMIN_NOTE (manuel checkout)
 * Hata → tüm işlem geri alınır (rezerv dahil). Zaman `now` parametreyle (ADR-0004).
 */
@Injectable()
export class ManualCheckoutService {
  private readonly logger = new Logger(ManualCheckoutService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly settings: SettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly pricing: PricingService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly deliveryDates: DeliveryDatesService,
  ) {}

  async createForCustomer(input: AdminCreateSubscriptionDto, ctx: ManualCheckoutContext): Promise<AdminCreateSubscriptionResult> {
    const now = ctx.now ?? new Date();
    const isOneTime = input.isOneTime ?? false;
    const commerce = await this.settings.getCommerce();

    const result = await this.repo.transaction(async (tx) => {
      // ── 1. doğrulama ───────────────────────────────────────────────────────
      const user = await this.repo.findUserById(input.userId, tx);
      if (!user || user.deletedAt || user.anonymizedAt) throw new NotFoundException({ message: 'Müşteri bulunamadı', error: 'CUSTOMER_NOT_FOUND' });
      if (!user.isActive) throw conflict('CUSTOMER_INACTIVE', 'Müşteri hesabı pasif');
      const tier = await this.repo.findTierBySlug(input.tierSlug, tx);
      if (!tier || !tier.isActive) throw new BadRequestException({ message: 'Kutu boyu geçersiz', error: 'TIER_INVALID' });
      const address = input.addressId ? await this.repo.findAddressForUser(input.addressId, user.id, tx) : await this.repo.findDefaultAddressForUser(user.id, tx);
      if (!address) throw new BadRequestException({ message: 'Müşterinin teslimat adresi yok (addressId ya da varsayılan adres gerekli)', error: SUB_ERRORS.ADDRESS_INVALID });
      if (!address.phone.trim()) throw new BadRequestException({ message: 'Adreste telefon yok', error: 'CUSTOMER_PHONE_REQUIRED' });
      if (input.paymentMethodId) {
        const pm = await this.repo.findPaymentMethodForUser(input.paymentMethodId, user.id, tx);
        if (!pm) throw new BadRequestException({ message: 'Kart geçersiz', error: SUB_ERRORS.PAYMENT_METHOD_INVALID });
      }
      const frequencyWeeks = isOneTime ? 1 : (input.frequencyWeeks ?? 1);
      if (!isOneTime && !commerce.frequencies.some((f) => f.weeks === frequencyWeeks)) {
        throw new BadRequestException({ message: 'Sıklık geçersiz', error: SUB_ERRORS.FREQUENCY_INVALID });
      }
      if (!commerce.deliveryDays.some((d) => d.id === deliveryDayToSlug(input.deliveryDay))) {
        throw new BadRequestException({ message: 'Teslimat günü geçersiz', error: SUB_ERRORS.DELIVERY_DAY_INVALID });
      }
      const itemPrefs = this.validateItemPrefs(input.itemPrefs);

      // ── 2. teslimat günü ───────────────────────────────────────────────────
      const zoneId = address.zoneId;
      const dd = input.deliveryOn
        ? await this.deliveryDates.findOrCreateFor(zoneId, input.deliveryOn as IsoDate, tx)
        : await this.deliveryDates.nextFor(zoneId, input.deliveryDay, now, tx);
      if (dd.day !== input.deliveryDay) {
        throw new BadRequestException({ message: `${utcToIsoDate(dd.date)} seçilen teslimat günü (${input.deliveryDay}) değil`, error: 'DELIVERY_DAY_MISMATCH' });
      }
      if (this.deliveryDates.isLocked(dd, now)) {
        throw new ConflictException({ message: 'Bu teslimat günü için sipariş kesimi geçti ya da gün kapalı', error: 'DAY_LOCKED' });
      }

      // ── 3. fiyat ───────────────────────────────────────────────────────────
      const extraProducts = await this.resolveExtras(input.extras ?? [], commerce, tx);
      const lines: PricingLineInput[] = [
        { kind: OrderLineKind.BOX, unitPrice: money(tier.price), qty: 1, tierSlug: tier.slug, name: tier.label },
        ...extraProducts.map((e) => ({ kind: OrderLineKind.EXTRA, unitPrice: money(e.product.price), qty: e.factor, vatRate: e.product.vatRate, productId: e.product.id, name: e.product.name })),
      ];
      const quote = await this.pricing.quote({ lines, zoneId, userId: user.id, isSubscriptionCheckout: !isOneTime });
      // Peşin tutar (F8 KARAR): kutu + ekstralar − indirim, KARGO HARİÇ — kargo Order.shippingFee'de tahsil edilir;
      // kesimde cycle#1 için kargo yeniden hesaplanmaz (SubscriptionsDepsAdapter.cycleCharge) → DELTA'da kargo yok
      const prepaidAmount = quote.prepaidAmount ?? quote.grandTotal;

      // ── 4. Subscription PENDING + cycle#1 ──────────────────────────────────
      const { subscription, cycle } = await this.subscriptions.createFromCheckout(
        { id: user.id },
        {
          tierSlug: tier.slug,
          frequencyWeeks,
          deliveryDay: input.deliveryDay,
          zoneId,
          addressId: address.id,
          paymentMethodId: input.paymentMethodId ?? null,
          isOneTime,
          itemPrefs,
          chargeStrategy: input.chargeStrategy,
          deliveryDateId: dd.id,
          orderId: null,
          prepaidAmount,
          items: input.items,
          extras: extraProducts.map((e) => ({ id: e.product.slug, factor: e.factor, label: e.label })),
          now,
        },
        tx,
      );

      // ── 5. Order (DeliveryDate rezerv + snapshot) ──────────────────────────
      const customerName = address.fullName.trim() || user.name?.trim() || user.email;
      const addressSnapshot: AddressSnapshot = { fullName: address.fullName, phone: address.phone, line: address.line, zoneId: address.zoneId, zoneName: address.zone.name, zip: address.zip };
      const { order } = await this.orders.createFromQuote(
        {
          quote,
          lines: this.snapshotLines(quote, tier, cycle, extraProducts),
          kind: quote.orderKind === OrderKind.SINGLE ? (isOneTime ? OrderKind.BOX_ONE_TIME : OrderKind.SUBSCRIPTION) : quote.orderKind,
          userId: user.id,
          subscriptionId: subscription.id,
          customer: { name: customerName, email: user.email, phone: address.phone },
          address: addressSnapshot,
          deliveryDateId: dd.id,
          note: `Manuel checkout (admin)${input.note ? `: ${input.note}` : ''}`,
          now,
        },
        tx,
      );
      await this.repo.updateCycle(cycle.id, { orderId: order.id }, tx);

      // ── 6. MANUAL ödeme → Order PAID ───────────────────────────────────────
      const pending = await this.payments.recordPayment(
        { orderId: order.id, provider: 'MANUAL', kind: 'CHECKOUT', conversationId: checkoutConversationId(order.id), amount: quote.grandTotal, is3ds: false, isMerchantInitiated: false },
        tx,
      );
      const payment = await this.payments.markSucceeded(pending.id, { providerPaymentId: `offline_${order.orderNo}`, paidAt: now }, tx);
      await this.orders.transition(order.id, 'PAID', { actor: 'ADMIN', actorId: ctx.adminId ?? null, now, releaseDeliveryDate: false }, tx);
      await this.repo.addEvent(
        {
          subscriptionId: subscription.id,
          cycleId: cycle.id,
          type: 'ADMIN_NOTE',
          actor: ACTOR.ADMIN,
          data: { manualCheckout: true, orderNo: order.orderNo, paymentId: payment.id, amount: quote.grandTotal, note: input.note ?? null, adminId: ctx.adminId ?? null },
          at: now,
        },
        tx,
      );

      // ── 7. aktivasyon (startedAt, ilk-kutu sayacı, ensure) ─────────────────
      await this.subscriptions.activate(subscription.id, { paymentMethodId: input.paymentMethodId ?? null, now }, tx);
      return { subscriptionId: subscription.id, cycleId: cycle.id, order, payment, quote, prepaidAmount };
    });

    this.logger.log(`Manuel checkout: sub ${result.subscriptionId} · sipariş #${result.order.orderNo} · ${result.quote.grandTotal} TL (admin ${ctx.adminId ?? '-'})`);
    const subscription = await this.subscriptions.getDetail(result.subscriptionId);
    const cycle = await this.repo.findCycleById(result.cycleId);
    if (!cycle) throw new NotFoundException('Cycle bulunamadı');
    return {
      subscription,
      cycle: toCycleDto(cycle as CycleRecord),
      order: { id: result.order.id, orderNo: result.order.orderNo, status: 'PAID', grandTotal: result.quote.grandTotal, prepaidAmount: result.prepaidAmount },
      payment: { id: result.payment.id, status: result.payment.status, amount: money(result.payment.amount) },
    };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private validateItemPrefs(prefs: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [slug, value] of Object.entries(prefs ?? {})) {
      if (typeof value !== 'string' || value.length > 60) throw new BadRequestException({ message: `Tercih geçersiz: ${slug}`, error: SUB_ERRORS.PREF_INVALID });
      if (value !== '') out[slug] = value;
    }
    return out;
  }

  private async resolveExtras(
    extras: ReadonlyArray<{ id: string; factor: number; label?: string }>,
    commerce: Awaited<ReturnType<SettingsService['getCommerce']>>,
    tx: Parameters<SubscriptionsRepository['findProductsBySlugs']>[1],
  ): Promise<Array<{ product: ProductRecord; factor: number; label: string }>> {
    if (extras.length === 0) return [];
    const products = await this.repo.findProductsBySlugs(extras.map((e) => e.id), tx);
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    return extras.map((extra) => {
      const product = bySlug.get(extra.id);
      if (!product || product.deletedAt !== null || product.status !== 'ACTIVE') {
        throw new BadRequestException({ message: `Ekstra ürün alınamaz: ${extra.id}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
      }
      const options = resolveExtraOptions(product.unit, commerce, product.extraOptions as ExtraOption[] | null);
      const option = options.find((o) => Math.abs(o.factor - extra.factor) < 1e-9);
      if (!option) throw new BadRequestException({ message: `Ekstra miktarı geçersiz: ${extra.id} × ${extra.factor}`, error: SUB_ERRORS.EXTRA_FACTOR_INVALID });
      return { product, factor: extra.factor, label: extra.label ?? option.label };
    });
  }

  /** PricedLine[] → Order satır snapshot'ı (BOX: tier + kutu içeriği metadata; EXTRA: ürün adı/birim/lot). */
  private snapshotLines(
    quote: PricingResult,
    tier: { slug: string; label: string },
    cycle: CycleRecord,
    extras: ReadonlyArray<{ product: ProductRecord; factor: number; label: string }>,
  ): OrderLineSnapshotInput[] {
    const boxItems: OrderLineBoxMetadata['items'] = cycle.items.filter(isBoxItem).map((i) => ({
      productId: i.productId,
      slug: i.product.slug,
      name: i.product.name,
      pref: i.pref,
      boxAmount: i.label ?? i.product.boxAmount ?? null,
      lotCode: i.lotCode ?? i.lot?.lotCode ?? null,
    }));
    const byProduct = new Map(extras.map((e) => [e.product.id, e]));
    return quote.lines.map((l): OrderLineSnapshotInput => {
      if (l.kind === OrderLineKind.BOX) {
        return { kind: l.kind, tierSlug: tier.slug, name: tier.label, unit: 'kutu', qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, vatRate: l.vatRate, metadata: { items: boxItems } satisfies OrderLineBoxMetadata };
      }
      const extra = l.productId ? byProduct.get(l.productId) : undefined;
      const product = extra?.product;
      return {
        kind: l.kind,
        productId: l.productId ?? null,
        name: product ? (extra.label && extra.label !== product.name ? `${product.name} · ${extra.label}` : product.name) : (l.name ?? 'Ekstra'),
        unit: product?.unit ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        vatRate: l.vatRate,
        pref: l.pref ?? null,
        lotCode: product?.lots[0]?.lotCode ?? null,
        metadata: extra ? { label: extra.label, source: 'EXTRA' } : null,
      };
    });
  }
}
