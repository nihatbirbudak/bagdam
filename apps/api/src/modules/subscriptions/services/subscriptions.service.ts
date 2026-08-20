import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BOOTSTRAP_VISIBLE_STOCK_STATUSES,
  deliveryDayFromSlug,
  FREQUENCY_WEEKS,
  isoDateToUtc,
  resolveExtraOptions,
  SUBSCRIPTION_OCCUPYING_STATES,
  subscriptionMachine,
  utcToIsoDate,
  type BootstrapSub,
  type ChargeStrategy,
  type DeliveryDay,
  type ExtraOption,
  type Subscription,
  type SubscriptionList,
  type SubscriptionStatus,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import { webUrl } from '../../mail/mail.constants';
import { SettingsService } from '../../settings/settings.service';
import type { AdminSubscriptionPatchDto, AdminSubscriptionsQueryDto } from '../dto/admin-subscription.dto';
import type { CurrentCyclePatchDto, MergeCartDto, SubscriptionPatchDto } from '../dto/me-subscription.dto';
import { SubscriptionNotifier } from '../subscription-notifier';
import { ACTOR, addOneYear, weekStartOf } from '../subscriptions.constants';
import { SUBSCRIPTIONS_DEPS, type SubscriptionsDeps, type Tx } from '../subscriptions.deps';
import { assertOr409, conflict, SUB_ERRORS } from '../subscriptions.errors';
import { isBoxItem, isExtraItem, money, pickCurrentCycle, pickInFlightCycle, toBootstrapSub, toDecimal, toQtyDecimal, toSubscriptionDto, toSubscriptionListItem } from '../subscriptions.mapper';
import { SubscriptionsRepository, type CycleRecord, type ProductRecord, type SubscriptionRecord } from '../subscriptions.repository';
import { CyclesService } from './cycles.service';

/** `GET /me/subscription` ve müşteri mutasyonlarının gördüğü durumlar (PENDING/CANCELLED/COMPLETED görünmez). */
export const CUSTOMER_VISIBLE_STATES: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCEL_REQUESTED'];

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

/** F8 checkout → `createFromCheckout` girdisi (işlem içinde; DD rezervi checkout'un — B1 reserve — sorumluluğu). */
export interface CreateFromCheckoutInput {
  tierSlug: string;
  frequencyWeeks: number;
  deliveryDay: DeliveryDay;
  zoneId: string;
  addressId: string | null;
  paymentMethodId?: string | null;
  isOneTime: boolean;
  itemPrefs: Record<string, string>;
  /** Yoksa Setting commerce.chargeStrategy. */
  chargeStrategy?: ChargeStrategy;
  /** cycle#1 teslimat günü (checkout rezerv etti). */
  deliveryDateId: string;
  /** Checkout Order'ı (cycle#1.orderId); F8 sonradan da bağlayabilir. */
  orderId?: string | null;
  /** Checkout'ta peşin ödenen kutu+ekstra tutarı (quote.prepaidAmount). */
  prepaidAmount: number;
  /** Seçilen kutu içeriği (ürün slug'ları); yoksa haftanın şablonu. */
  items?: string[];
  extras?: Array<{ id: string; factor: number; label?: string | null }>;
  contractDocId?: string | null;
  now?: Date;
}

/**
 * SubscriptionsService — abonelik yaşam döngüsü (docs/state-machines.md §2, §6, §10; ADR-0007/0008):
 * checkout'tan oluşturma + aktivasyon (F8 çağırır), müşteri DTO'su (BootstrapSub), freq/gün/adres/kart PATCH
 * (SCHEDULED cycle'lar yeniden üretilir), swap/pref/extras/merge-cart (SCHEDULED & kesimden önce), skip/unskip
 * (yılda N, hak iadesi, cycle#1 atlanamaz), admin liste/detay/PATCH (iptal dahil). Cycle motoru: CyclesService.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly settings: SettingsService,
    private readonly cycles: CyclesService,
    private readonly notifier: SubscriptionNotifier,
    @Inject(SUBSCRIPTIONS_DEPS) private readonly deps: SubscriptionsDeps,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // F8: checkout → PENDING + cycle#1 · ödeme → ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════

  async createFromCheckout(user: { id: string }, input: CreateFromCheckoutInput, tx?: Tx): Promise<{ subscription: SubscriptionRecord; cycle: CycleRecord }> {
    const run = async (db: Tx) => {
      const now = input.now ?? new Date();
      const occupying = await this.repo.countSubscriptionsForUser(user.id, SUBSCRIPTION_OCCUPYING_STATES, db);
      if (occupying > 0) throw conflict(SUB_ERRORS.SUBSCRIPTION_EXISTS, 'Aynı anda tek abonelik (ya da tek seferlik kutu) olabilir');
      const tier = await this.repo.findTierBySlug(input.tierSlug, db);
      if (!tier || !tier.isActive) throw new BadRequestException({ message: 'Kutu boyu geçersiz', error: 'TIER_INVALID' });
      const commerce = await this.settings.getCommerce();
      const dd = await this.repo.findDeliveryDateById(input.deliveryDateId, db);
      if (!dd || dd.zoneId !== input.zoneId) throw new BadRequestException({ message: 'Teslimat günü geçersiz', error: 'DELIVERY_DATE_INVALID' });
      if (input.addressId) {
        const address = await this.repo.findAddressForUser(input.addressId, user.id, db);
        if (!address) throw new BadRequestException({ message: 'Adres geçersiz', error: SUB_ERRORS.ADDRESS_INVALID });
      }
      if (input.paymentMethodId) {
        const pm = await this.repo.findPaymentMethodForUser(input.paymentMethodId, user.id, db);
        if (!pm) throw new BadRequestException({ message: 'Kart geçersiz', error: SUB_ERRORS.PAYMENT_METHOD_INVALID });
      }
      const userRow = await db.user.findUnique({ where: { id: user.id }, select: { firstBoxesPromoUsedAt: true } });
      const promoAvailable = !commerce.firstBoxDiscount.perUserOnce || userRow?.firstBoxesPromoUsedAt === null;
      const discountBoxesLeft = !input.isOneTime && promoAvailable ? commerce.firstBoxDiscount.boxes : 0;
      const itemPrefs = input.itemPrefs ?? {};

      const subscription = await this.repo.createSubscription(
        {
          userId: user.id,
          tierId: tier.id,
          isOneTime: input.isOneTime,
          status: 'PENDING',
          frequencyWeeks: input.isOneTime ? 1 : input.frequencyWeeks,
          deliveryDay: input.deliveryDay,
          zoneId: input.zoneId,
          addressId: input.addressId,
          paymentMethodId: input.paymentMethodId ?? null,
          itemPrefs: itemPrefs as Prisma.InputJsonValue,
          chargeStrategy: input.chargeStrategy ?? commerce.chargeStrategy,
          discountBoxesLeft,
          contractDocId: input.contractDocId ?? null,
          nextDeliveryOn: dd.date,
          nextCutoffAt: dd.cutoffAt,
        },
        db,
      );

      const cycle = await this.repo.createCycle(
        { subscriptionId: subscription.id, cycleNo: 1, deliveryDateId: dd.id, status: 'SCHEDULED', prepaidAmount: toDecimal(input.prepaidAmount), orderId: input.orderId ?? null },
        db,
      );

      // İçerik: seçilen slug'lar (şablondakiler TEMPLATE, diğerleri SWAP) ya da haftanın şablonu
      const weekStart = isoDateToUtc(weekStartOf(utcToIsoDate(dd.date)));
      const tpl = await this.repo.findPublishedTemplate(tier.id, weekStart, db);
      const items: Prisma.CycleItemUncheckedCreateInput[] = [];
      if (input.items && input.items.length > 0) {
        const products = await this.repo.findProductsBySlugs(input.items, db);
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        const templateIds = new Set((tpl?.items ?? []).map((ti) => ti.productId));
        input.items.forEach((slug, idx) => {
          const product = bySlug.get(slug);
          if (!product || product.deletedAt !== null) throw new BadRequestException({ message: `Ürün bulunamadı: ${slug}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
          const tplItem = tpl?.items.find((ti) => ti.productId === product.id);
          items.push(this.cycles.boxItemInput(cycle.id, product, templateIds.has(product.id) ? 'TEMPLATE' : 'SWAP', idx, itemPrefs, tplItem?.qtyLabel ?? null));
        });
      } else {
        if (!tpl) throw conflict(SUB_ERRORS.BOX_TEMPLATE_MISSING, 'Bu hafta için yayınlanmış kutu şablonu yok');
        items.push(...this.cycles.templateItems(cycle.id, tpl, itemPrefs));
      }
      if (input.extras && input.extras.length > 0) {
        const products = await this.repo.findProductsBySlugs(input.extras.map((e) => e.id), db);
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        for (const extra of input.extras) {
          const product = bySlug.get(extra.id);
          if (!product || product.deletedAt !== null) throw new BadRequestException({ message: `Ekstra ürün bulunamadı: ${extra.id}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
          items.push(this.extraItemInput(cycle.id, product, extra.factor, extra.label ?? null, items.length, 'EXTRA'));
        }
      }
      await this.repo.createCycleItems(items, db);
      await this.repo.addEvent({ subscriptionId: subscription.id, cycleId: cycle.id, type: 'CREATED', actor: ACTOR.USER, data: { source: 'checkout', isOneTime: input.isOneTime, prepaidAmount: input.prepaidAmount, discountBoxesLeft }, at: now }, db);
      const fresh = await this.repo.findCycleById(cycle.id, db);
      return { subscription: (await this.repo.findSubscriptionById(subscription.id, db))!, cycle: fresh as CycleRecord };
    };
    return tx ? run(tx) : this.repo.transaction(run);
  }

  /** PENDING → ACTIVE (checkout ödemesi): startedAt, skipsResetAt, ilk-kutu sayacı + User işareti, ensure. */
  async activate(subscriptionId: string, opts: { paymentMethodId?: string | null; now?: Date } = {}, tx?: Tx): Promise<SubscriptionRecord> {
    const run = async (db: Tx) => {
      const now = opts.now ?? new Date();
      await this.repo.lockSubscription(subscriptionId, db);
      const sub = await this.repo.findSubscriptionById(subscriptionId, db);
      if (!sub) throw new NotFoundException('Abonelik bulunamadı');
      if (sub.status === 'ACTIVE') return sub;
      assertOr409(subscriptionMachine, sub.status as SubscriptionStatus, 'ACTIVE');
      const data: Prisma.SubscriptionUncheckedUpdateInput = { status: 'ACTIVE', startedAt: now, skipsResetAt: addOneYear(now) };
      if (opts.paymentMethodId) data.paymentMethodId = opts.paymentMethodId;
      if (!sub.isOneTime && sub.discountBoxesLeft > 0) {
        data.discountBoxesLeft = sub.discountBoxesLeft - 1; // cycle#1 indirimi checkout'ta uygulandı
        if (sub.user.firstBoxesPromoUsedAt === null) await this.repo.updateUser(sub.userId, { firstBoxesPromoUsedAt: now }, db);
      }
      await this.repo.updateSubscription(sub.id, data, db);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: null, type: 'ACTIVATED', actor: ACTOR.PSP, data: { paymentMethodId: opts.paymentMethodId ?? sub.paymentMethodId }, at: now }, db);
      const commerce = await this.settings.getCommerce();
      await this.cycles.ensureSubscriptionInTx(sub.id, now, commerce, db);
      this.logger.log(`Abonelik aktifleştirildi (sub:${sub.id}, oneTime=${sub.isOneTime})`);
      this.notifier.emit('subscription.activated', { subscriptionId: sub.id, userId: sub.userId, data: { isOneTime: sub.isOneTime } }, now);
      return (await this.repo.findSubscriptionById(sub.id, db))!;
    };
    return tx ? run(tx) : this.repo.transaction(run);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Müşteri: okuma
  // ═══════════════════════════════════════════════════════════════════════════

  async getForUser(userId: string, now: Date = new Date()): Promise<BootstrapSub | null> {
    const sub = await this.repo.findSubscriptionForUser(userId, CUSTOMER_VISIBLE_STATES);
    return sub ? this.buildBootstrapSub(sub, now) : null;
  }

  async buildBootstrapSub(sub: SubscriptionRecord, now: Date): Promise<BootstrapSub> {
    const [cycles, openCancellation, commerce] = await Promise.all([
      this.repo.findCyclesOfSubscription(sub.id),
      this.repo.findOpenCancellation(sub.id),
      this.settings.getCommerce(),
    ]);
    const current = pickCurrentCycle(cycles, now);
    const inFlight = pickInFlightCycle(cycles);
    const liveTotal = current && current.status === 'SCHEDULED' ? await this.cycles.liveTotal(sub, current, now) : null;
    let paymentLinkUrl: string | null = null;
    if (inFlight && inFlight.status === 'AWAITING_PAYMENT') {
      const orderRef = inFlight.cycleNo === 1 && inFlight.deltaOrderId ? inFlight.deltaOrder : inFlight.order;
      const open = orderRef ? await this.repo.findOpenLinkPayments(orderRef.id) : [];
      const token = open.find((p) => p.linkToken)?.linkToken ?? null;
      paymentLinkUrl = token ? `${webUrl()}/api/v1/pay/${token}` : null;
    }
    return toBootstrapSub({ sub, cycles, openCancellation, now, skipsPerYear: commerce.skipsPerYear, liveTotal, paymentLinkUrl });
  }

  async requireForUser(userId: string): Promise<SubscriptionRecord> {
    const sub = await this.repo.findSubscriptionForUser(userId, CUSTOMER_VISIBLE_STATES);
    if (!sub) throw new NotFoundException({ message: 'Aktif abonelik yok', error: SUB_ERRORS.NO_SUBSCRIPTION });
    return sub;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Müşteri: PATCH freq/gün/adres/kart
  // ═══════════════════════════════════════════════════════════════════════════

  async patchForUser(userId: string, dto: SubscriptionPatchDto, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.requireForUser(userId);
    if (dto.freq === undefined && dto.deliveryDay === undefined && dto.addressId === undefined && dto.paymentMethodId === undefined) {
      throw new BadRequestException('Güncellenecek alan yok');
    }
    const commerce = await this.settings.getCommerce();
    const patch: AdminSubscriptionPatchDto = {};
    if (dto.freq !== undefined) {
      const weeks = FREQUENCY_WEEKS[dto.freq];
      if (!commerce.frequencies.some((f) => f.weeks === weeks)) throw new BadRequestException({ message: 'Sıklık geçersiz', error: SUB_ERRORS.FREQUENCY_INVALID });
      patch.frequencyWeeks = weeks;
    }
    if (dto.deliveryDay !== undefined) {
      const day = deliveryDayFromSlug(dto.deliveryDay);
      if (!day || !commerce.deliveryDays.some((d) => d.id === dto.deliveryDay)) throw new BadRequestException({ message: 'Teslimat günü geçersiz', error: SUB_ERRORS.DELIVERY_DAY_INVALID });
      patch.deliveryDay = day;
    }
    if (dto.addressId !== undefined) patch.addressId = dto.addressId;
    if (dto.paymentMethodId !== undefined) patch.paymentMethodId = dto.paymentMethodId;
    await this.applyPatch(sub, patch, ACTOR.USER, now);
    return this.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  /** Ortak PATCH uygulaması (müşteri/admin): alanlar + olaylar + SCHEDULED cycle'ların yeniden üretimi. */
  private async applyPatch(sub: SubscriptionRecord, patch: AdminSubscriptionPatchDto, actor: string, now: Date): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const fresh = (await this.repo.findSubscriptionById(sub.id, tx))!;
      const data: Prisma.SubscriptionUncheckedUpdateInput = {};
      let regenerate = false;
      let cardChanged = false;
      const events: Array<{ type: 'FREQ_CHANGED' | 'DAY_CHANGED' | 'CARD_UPDATED' | 'ADMIN_NOTE'; data: Record<string, unknown> }> = [];
      if (patch.frequencyWeeks !== undefined && !fresh.isOneTime && patch.frequencyWeeks !== fresh.frequencyWeeks) {
        data.frequencyWeeks = patch.frequencyWeeks;
        regenerate = true;
        events.push({ type: 'FREQ_CHANGED', data: { from: fresh.frequencyWeeks, to: patch.frequencyWeeks } });
      }
      if (patch.deliveryDay !== undefined && patch.deliveryDay !== fresh.deliveryDay) {
        data.deliveryDay = patch.deliveryDay;
        regenerate = true;
        events.push({ type: 'DAY_CHANGED', data: { from: fresh.deliveryDay, to: patch.deliveryDay } });
      }
      if (patch.addressId !== undefined && patch.addressId !== fresh.addressId) {
        const address = await this.repo.findAddressForUser(patch.addressId, fresh.userId, tx);
        if (!address) throw new BadRequestException({ message: 'Adres geçersiz', error: SUB_ERRORS.ADDRESS_INVALID });
        data.addressId = address.id;
        if (address.zoneId !== fresh.zoneId) {
          data.zoneId = address.zoneId;
          regenerate = true;
        }
        events.push({ type: 'ADMIN_NOTE', data: { field: 'address', addressId: address.id, zoneChanged: address.zoneId !== fresh.zoneId } });
      }
      if (patch.paymentMethodId !== undefined && patch.paymentMethodId !== fresh.paymentMethodId) {
        if (patch.paymentMethodId === null) {
          data.paymentMethodId = null;
        } else {
          const pm = await this.repo.findPaymentMethodForUser(patch.paymentMethodId, fresh.userId, tx);
          if (!pm) throw new BadRequestException({ message: 'Kart geçersiz', error: SUB_ERRORS.PAYMENT_METHOD_INVALID });
          data.paymentMethodId = pm.id;
          cardChanged = true;
        }
        events.push({ type: 'CARD_UPDATED', data: { paymentMethodId: patch.paymentMethodId } });
      }
      if (patch.chargeStrategy !== undefined && patch.chargeStrategy !== fresh.chargeStrategy) {
        data.chargeStrategy = patch.chargeStrategy;
        events.push({ type: 'ADMIN_NOTE', data: { field: 'chargeStrategy', from: fresh.chargeStrategy, to: patch.chargeStrategy } });
      }
      if (patch.note) events.push({ type: 'ADMIN_NOTE', data: { note: patch.note } });
      if (Object.keys(data).length > 0) await this.repo.updateSubscription(fresh.id, data, tx);
      for (const e of events) await this.repo.addEvent({ subscriptionId: fresh.id, cycleId: null, type: e.type, actor, data: e.data, at: now }, tx);
      if (regenerate) await this.cycles.regenerateScheduledCycles(fresh.id, now, tx);
      if (cardChanged) {
        // Kart güncellendi → açık UNPAID cycle anında yeniden denenir (§9)
        await this.repo.updateCycleWhere({ subscriptionId: fresh.id, status: 'UNPAID' }, { nextRetryAt: now }, tx);
      }
      await this.cycles.refreshNextDelivery(fresh.id, tx);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Müşteri: açık cycle — swap / pref / extras / merge-cart
  // ═══════════════════════════════════════════════════════════════════════════

  async patchCurrentCycle(userId: string, dto: CurrentCyclePatchDto, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.requireForUser(userId);
    if (dto.items === undefined && dto.itemPrefs === undefined && dto.extras === undefined) throw new BadRequestException('Güncellenecek alan yok');
    const commerce = await this.settings.getCommerce();
    await this.repo.transaction(async (tx) => {
      const cycle = await this.requireEditableCycle(sub.id, now, tx, dto.cycleId);
      const itemPrefs = { ...((sub.itemPrefs as Record<string, string> | null) ?? {}) };

      // ── itemPrefs (kalıcı; mevcut cycle öğelerine de uygulanır)
      if (dto.itemPrefs !== undefined) {
        const slugs = Object.keys(dto.itemPrefs);
        const products = await this.repo.findProductsBySlugs(slugs, tx);
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        for (const [slug, value] of Object.entries(dto.itemPrefs)) {
          const product = bySlug.get(slug);
          if (!product) throw new BadRequestException({ message: `Ürün bulunamadı: ${slug}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
          if (typeof value !== 'string' || value.length > 60) throw new BadRequestException({ message: `Tercih geçersiz: ${slug}`, error: SUB_ERRORS.PREF_INVALID });
          if (value === '') {
            delete itemPrefs[slug];
            continue;
          }
          if (product.prefOptions.length > 0 && !product.prefOptions.includes(value)) {
            throw new BadRequestException({ message: `Tercih seçeneği geçersiz: ${slug} → ${value}`, error: SUB_ERRORS.PREF_INVALID });
          }
          itemPrefs[slug] = value;
          for (const item of cycle.items.filter((i) => isBoxItem(i) && i.product.slug === slug)) await this.repo.updateCycleItem(item.id, { pref: value }, tx);
        }
        await this.repo.updateSubscription(sub.id, { itemPrefs: itemPrefs as Prisma.InputJsonValue }, tx);
        await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'PREF_CHANGED', actor: ACTOR.USER, data: { itemPrefs: dto.itemPrefs }, at: now }, tx);
      }

      // ── items (swap): yeni liste = kutu içeriği; şablondakiler TEMPLATE, diğerleri SWAP (fresh + stokta)
      if (dto.items !== undefined) {
        const boxItems = cycle.items.filter(isBoxItem);
        const wanted = [...new Set(dto.items)];
        if (wanted.length !== boxItems.length) {
          throw conflict(SUB_ERRORS.BOX_ITEM_COUNT, `Kutu ${boxItems.length} ürün içermeli (gönderilen: ${wanted.length})`);
        }
        const products = await this.repo.findProductsBySlugs(wanted, tx);
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        const tpl = await this.repo.findPublishedTemplate(sub.tierId, isoDateToUtc(weekStartOf(utcToIsoDate(cycle.deliveryDate.date))), tx);
        const templateIds = new Set((tpl?.items ?? []).map((ti) => ti.productId));
        const currentByProduct = new Map(boxItems.map((i) => [i.productId, i]));
        const keep = new Set<string>();
        const added: string[] = [];
        const removed: string[] = [];
        const removedTemplateProducts = boxItems.filter((i) => !wanted.includes(i.product.slug)).map((i) => (i.source === 'SWAP' && i.swapOfProductId ? i.swapOfProductId : i.productId));
        const creates: Prisma.CycleItemUncheckedCreateInput[] = [];
        wanted.forEach((slug, idx) => {
          const product = bySlug.get(slug);
          if (!product || product.deletedAt !== null || product.status !== 'ACTIVE') {
            throw new BadRequestException({ message: `Ürün kutuya eklenemez: ${slug}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
          }
          const existing = currentByProduct.get(product.id);
          if (existing) {
            keep.add(existing.id);
            return;
          }
          const isTemplate = templateIds.has(product.id);
          if (!isTemplate && (!product.isFresh || !(BOOTSTRAP_VISIBLE_STOCK_STATUSES as readonly string[]).includes(product.stockStatus))) {
            throw conflict(SUB_ERRORS.PRODUCT_NOT_SWAPPABLE, `Ürün kutu havuzunda değil ya da stokta yok: ${slug}`);
          }
          const tplItem = tpl?.items.find((ti) => ti.productId === product.id);
          creates.push(this.cycles.boxItemInput(cycle.id, product, isTemplate ? 'TEMPLATE' : 'SWAP', idx, itemPrefs, tplItem?.qtyLabel ?? null, isTemplate ? null : (removedTemplateProducts.shift() ?? null)));
          added.push(slug);
        });
        for (const item of boxItems) {
          if (!keep.has(item.id)) removed.push(item.product.slug);
        }
        if (removed.length > 0) await this.repo.deleteCycleItems({ id: { in: boxItems.filter((i) => !keep.has(i.id)).map((i) => i.id) } }, tx);
        await this.repo.createCycleItems(creates, tx);
        if (added.length > 0 || removed.length > 0) {
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'SWAP', actor: ACTOR.USER, data: { added, removed }, at: now }, tx);
        }
      }

      // ── extras (tam liste; (ürün, çarpan) kimliğiyle eşleştirilir; unitPrice snapshot eklenme anında)
      if (dto.extras !== undefined) {
        const extraItems = cycle.items.filter(isExtraItem);
        const products = await this.repo.findProductsBySlugs(dto.extras.map((e) => e.id), tx);
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        const keep = new Set<string>();
        const added: Array<{ slug: string; factor: number }> = [];
        const creates: Prisma.CycleItemUncheckedCreateInput[] = [];
        for (const extra of dto.extras) {
          const product = bySlug.get(extra.id);
          if (!product || product.deletedAt !== null || product.status !== 'ACTIVE' || !(BOOTSTRAP_VISIBLE_STOCK_STATUSES as readonly string[]).includes(product.stockStatus)) {
            throw new BadRequestException({ message: `Ekstra ürün alınamaz: ${extra.id}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
          }
          const options = resolveExtraOptions(product.unit, commerce, product.extraOptions as ExtraOption[] | null);
          const option = options.find((o) => Math.abs(o.factor - extra.factor) < 1e-9);
          if (!option) throw new BadRequestException({ message: `Ekstra miktarı geçersiz: ${extra.id} × ${extra.factor}`, error: SUB_ERRORS.EXTRA_FACTOR_INVALID });
          const existing = extraItems.find((i) => !keep.has(i.id) && i.productId === product.id && Math.abs(Number(i.qty.toString()) - extra.factor) < 1e-9);
          if (existing) {
            keep.add(existing.id);
            continue;
          }
          creates.push(this.extraItemInput(cycle.id, product, extra.factor, extra.label ?? option.label, cycle.items.length + creates.length, 'EXTRA'));
          added.push({ slug: product.slug, factor: extra.factor });
        }
        const removed = extraItems.filter((i) => !keep.has(i.id));
        if (removed.length > 0) {
          await this.repo.deleteCycleItems({ id: { in: removed.map((i) => i.id) } }, tx);
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'EXTRA_REMOVED', actor: ACTOR.USER, data: { items: removed.map((i) => ({ slug: i.product.slug, factor: Number(i.qty.toString()), source: i.source })) }, at: now }, tx);
        }
        if (creates.length > 0) {
          await this.repo.createCycleItems(creates, tx);
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'EXTRA_ADDED', actor: ACTOR.USER, data: { items: added }, at: now }, tx);
        }
      }
    });
    return this.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  /** "Bu haftaki kutuma ekle": sepet satırları → CART_MERGE öğeleri (aynı ürün varsa adet artar). */
  async mergeCart(userId: string, dto: MergeCartDto, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.requireForUser(userId);
    await this.repo.transaction(async (tx) => {
      const cycle = await this.requireEditableCycle(sub.id, now, tx, dto.cycleId);
      const products = await this.repo.findProductsBySlugs(dto.lines.map((l) => l.id), tx);
      const bySlug = new Map(products.map((p) => [p.slug, p]));
      const merged: Array<{ slug: string; qty: number }> = [];
      let sortOrder = cycle.items.length;
      for (const line of dto.lines) {
        const product = bySlug.get(line.id);
        if (!product || product.deletedAt !== null || product.status !== 'ACTIVE' || !(BOOTSTRAP_VISIBLE_STOCK_STATUSES as readonly string[]).includes(product.stockStatus)) {
          throw new BadRequestException({ message: `Ürün sepetten eklenemez: ${line.id}`, error: SUB_ERRORS.PRODUCT_NOT_AVAILABLE });
        }
        const existing = cycle.items.find((i) => i.source === 'CART_MERGE' && i.productId === product.id && (i.pref ?? null) === (line.pref ?? null));
        if (existing) {
          const qty = Number(existing.qty.toString()) + line.qty;
          await this.repo.updateCycleItem(existing.id, { qty: toQtyDecimal(qty), label: `${qty} × ${product.unit}` }, tx);
        } else {
          await this.repo.createCycleItems([{ ...this.extraItemInput(cycle.id, product, line.qty, `${line.qty} × ${product.unit}`, sortOrder++, 'CART_MERGE'), pref: line.pref ?? null }], tx);
        }
        merged.push({ slug: product.slug, qty: line.qty });
      }
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'CART_MERGED', actor: ACTOR.USER, data: { lines: merged }, at: now }, tx);
    });
    return this.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  private extraItemInput(cycleId: string, product: ProductRecord, factor: number, label: string | null, sortOrder: number, source: 'EXTRA' | 'CART_MERGE'): Prisma.CycleItemUncheckedCreateInput {
    return {
      cycleId,
      source,
      productId: product.id,
      lotId: product.lots[0]?.id ?? null,
      lotCode: product.lots[0]?.lotCode ?? null,
      pref: null,
      qty: toQtyDecimal(factor),
      unit: product.unit,
      label,
      unitPrice: toDecimal(money(product.price)),
      sortOrder,
    };
  }

  /**
   * Düzenlenebilir cycle: `cycleId` verilmişse o cycle (kesimi geçtiyse 409 CYCLE_LOCKED — "12:01 red"; SCHEDULED değilse
   * CYCLE_NOT_EDITABLE); verilmemişse en yakın SCHEDULED/SKIPPED ve kesimi geçmemiş cycle (yoksa 409).
   */
  private async requireEditableCycle(subscriptionId: string, now: Date, tx: Tx, cycleId?: string): Promise<CycleRecord> {
    const cycles = await this.repo.findCyclesOfSubscription(subscriptionId, tx);
    let target: CycleRecord | null;
    if (cycleId) {
      target = cycles.find((c) => c.id === cycleId) ?? null;
      if (!target) throw new NotFoundException({ message: 'Cycle bulunamadı', error: SUB_ERRORS.NO_CURRENT_CYCLE });
      if (target.deliveryDate.cutoffAt.getTime() <= now.getTime()) throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kesim geçti — bu haftanın kutusu artık düzenlenemez');
    } else {
      target = pickCurrentCycle(cycles, now);
      if (!target) {
        const pastCutoff = cycles.find((c) => c.status === 'SCHEDULED');
        if (pastCutoff) throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kesim geçti — bu haftanın kutusu artık düzenlenemez');
        throw conflict(SUB_ERRORS.NO_CURRENT_CYCLE, 'Düzenlenebilir bir kutu dönemi yok');
      }
    }
    if (target.status !== 'SCHEDULED') {
      throw conflict(SUB_ERRORS.CYCLE_NOT_EDITABLE, target.status === 'SKIPPED' ? 'Bu hafta atlandı — önce atlamayı geri alın' : `Kutu düzenlenemez (durum: ${target.status})`);
    }
    if (!(await this.repo.lockCycle(target.id, 'SCHEDULED', tx))) throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kutu şu anda işleniyor, yeniden deneyin');
    return target;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Müşteri: skip / unskip (§10)
  // ═══════════════════════════════════════════════════════════════════════════

  async skip(userId: string, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.requireForUser(userId);
    const commerce = await this.settings.getCommerce();
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const fresh = (await this.repo.findSubscriptionById(sub.id, tx))!;
      const cycles = await this.repo.findCyclesOfSubscription(sub.id, tx);
      const current = pickCurrentCycle(cycles, now);
      if (!current || current.status !== 'SCHEDULED') {
        if (current?.status === 'SKIPPED') throw conflict(SUB_ERRORS.CYCLE_NOT_EDITABLE, 'Bu hafta zaten atlandı');
        throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kesim geçti — bu hafta artık atlanamaz');
      }
      if (current.cycleNo === 1 && !commerce.firstCycleSkippable) throw conflict(SUB_ERRORS.FIRST_CYCLE_NOT_SKIPPABLE, 'İlk kutu atlanamaz');
      // Yıl dönümü sıfırlaması
      let skipsUsed = fresh.skipsUsed;
      let skipsResetAt = fresh.skipsResetAt;
      if (skipsResetAt && skipsResetAt.getTime() <= now.getTime()) {
        skipsUsed = 0;
        while (skipsResetAt.getTime() <= now.getTime()) skipsResetAt = addOneYear(skipsResetAt);
      }
      if (skipsUsed >= commerce.skipsPerYear) throw conflict(SUB_ERRORS.SKIP_LIMIT_REACHED, `Yılda ${commerce.skipsPerYear} atlama hakkı kullanıldı`);
      const n = await this.repo.updateCycleWhere({ id: current.id, status: 'SCHEDULED' }, { status: 'SKIPPED', skipSource: 'USER', skippedAt: now }, tx);
      if (n !== 1) throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kutu şu anda işleniyor, yeniden deneyin');
      await this.deps.deliveryDates.release(current.deliveryDateId, tx);
      await this.repo.updateSubscription(sub.id, { skipsUsed: skipsUsed + 1, skipsResetAt }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: current.id, type: 'SKIP', actor: ACTOR.USER, data: { source: 'USER', skipsUsed: skipsUsed + 1 }, at: now }, tx);
      await this.cycles.ensureSubscriptionInTx(sub.id, now, commerce, tx);
    });
    return this.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  async unskip(userId: string, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.requireForUser(userId);
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const fresh = (await this.repo.findSubscriptionById(sub.id, tx))!;
      const cycles = await this.repo.findCyclesOfSubscription(sub.id, tx);
      const current = pickCurrentCycle(cycles, now);
      if (!current || current.status !== 'SKIPPED' || current.skipSource !== 'USER') throw conflict(SUB_ERRORS.NOT_SKIPPED, 'Geri alınacak bir atlama yok');
      await this.deps.deliveryDates.reserve(current.deliveryDateId, tx); // dolu → 409 DAY_FULL
      const n = await this.repo.updateCycleWhere({ id: current.id, status: 'SKIPPED' }, { status: 'SCHEDULED', skipSource: null, skippedAt: null }, tx);
      if (n !== 1) throw conflict(SUB_ERRORS.CYCLE_LOCKED, 'Kutu şu anda işleniyor, yeniden deneyin');
      await this.repo.updateSubscription(sub.id, { skipsUsed: Math.max(0, fresh.skipsUsed - 1) }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: current.id, type: 'UNSKIP', actor: ACTOR.USER, data: { skipsUsed: Math.max(0, fresh.skipsUsed - 1) }, at: now }, tx);
      await this.cycles.refreshNextDelivery(sub.id, tx);
    });
    return this.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin
  // ═══════════════════════════════════════════════════════════════════════════

  async adminList(query: AdminSubscriptionsQueryDto): Promise<SubscriptionList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total } = await this.repo.adminListSubscriptions({ status: query.status, q: query.q || undefined }, (page - 1) * limit, limit);
    return { items: rows.map(toSubscriptionListItem), total, page, limit };
  }

  async getDetail(id: string): Promise<Subscription> {
    const sub = await this.repo.findSubscriptionById(id);
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    const [cycles, cancellations, events] = await Promise.all([this.repo.findCyclesOfSubscription(id), this.repo.findCancellations(id), this.repo.findEvents(id)]);
    return toSubscriptionDto(sub, { cycles, cancellations, events });
  }

  /** Admin PATCH: durum (CANCELLED → iptal akışı dışı fesih; PAUSED/ACTIVE P2 admin), alanlar, strateji, not. */
  async adminPatch(id: string, dto: AdminSubscriptionPatchDto, actor: string, now: Date = new Date()): Promise<Subscription> {
    const sub = await this.repo.findSubscriptionById(id);
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    const { status, ...rest } = dto;
    if (Object.keys(rest).some((k) => (rest as Record<string, unknown>)[k] !== undefined)) await this.applyPatch(sub, rest, actor, now);
    if (status !== undefined && status !== sub.status) await this.adminSetStatus(sub.id, status, dto.note, actor, now);
    return this.getDetail(id);
  }

  private async adminSetStatus(subscriptionId: string, status: SubscriptionStatus, note: string | undefined, actor: string, now: Date): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(subscriptionId, tx);
      const sub = (await this.repo.findSubscriptionById(subscriptionId, tx))!;
      const from = sub.status as SubscriptionStatus;
      assertOr409(subscriptionMachine, from, status);
      switch (status) {
        case 'CANCELLED': {
          const cancellation = await this.repo.createCancellation({ subscriptionId: sub.id, reason: 'OTHER', reasonText: note ?? 'Admin iptali', retentionOffered: false, outcome: 'PENDING', requestedAt: now }, tx);
          const r = await this.cycles.cancelSubscription(sub.id, { actor, reason: note ?? 'Admin iptali', requestedAt: now }, now, tx);
          await this.repo.updateCancellation(cancellation.id, { outcome: 'CANCELLED', confirmedAt: now, effectiveAt: r.effectiveAt, refundAmount: toDecimal(r.refundAmount), refundDueAt: r.refundDueAt }, tx);
          break;
        }
        case 'PAUSED': {
          await this.repo.updateSubscription(sub.id, { status: 'PAUSED' }, tx);
          const cycles = await this.repo.findCyclesOfSubscription(sub.id, tx);
          for (const c of cycles.filter((c) => c.status === 'SCHEDULED' && c.cycleNo > 1)) {
            await this.repo.updateCycle(c.id, { status: 'CANCELLED' }, tx);
            await this.deps.deliveryDates.release(c.deliveryDateId, tx);
          }
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: null, type: 'PAUSED', actor, data: { note: note ?? null }, at: now }, tx);
          await this.cycles.refreshNextDelivery(sub.id, tx);
          break;
        }
        case 'ACTIVE': {
          await this.repo.updateSubscription(sub.id, { status: 'ACTIVE', cancelRequestedAt: null, ...(from === 'PAST_DUE' ? { failedCycles: 0 } : {}) }, tx);
          if (from === 'CANCEL_REQUESTED') {
            const open = await this.repo.findOpenCancellation(sub.id, tx);
            if (open) await this.repo.updateCancellation(open.id, { outcome: 'ABANDONED' }, tx);
          }
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: null, type: from === 'PAST_DUE' ? 'CHARGED' : 'RESUMED', actor, data: { note: note ?? null, from, manual: true }, at: now }, tx);
          const commerce = await this.settings.getCommerce();
          await this.cycles.ensureSubscriptionInTx(sub.id, now, commerce, tx);
          break;
        }
        default:
          throw conflict(SUB_ERRORS.SUBSCRIPTION_TRANSITION_INVALID, `Admin bu duruma geçiremez: ${status}`);
      }
    });
  }
}
