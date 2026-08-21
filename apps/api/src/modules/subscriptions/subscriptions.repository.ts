import { Injectable } from '@nestjs/common';
import { Prisma, type CycleStatus, type OrderStatus as OrderStatusEnum, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SYSTEM_WARN_DIGEST_MS } from './subscriptions.constants';

/** Repository çağrıları isteğe bağlı bir Prisma işlemi (interactive transaction) içinde koşabilir. */
export type Db = Prisma.TransactionClient;

// ── Include / select sabitleri + kayıt tipleri (Prisma YALNIZ bu dosyada — ADR-0002) ──────────────────────────

export const SUB_INCLUDE = {
  user: { select: { id: true, email: true, name: true, phone: true, retentionOfferUsedAt: true, firstBoxesPromoUsedAt: true } },
  tier: true,
  zone: true,
  address: { include: { zone: { select: { id: true, name: true, slug: true } } } },
  paymentMethod: true,
} satisfies Prisma.SubscriptionInclude;
export type SubscriptionRecord = Prisma.SubscriptionGetPayload<{ include: typeof SUB_INCLUDE }>;

export const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  unit: true,
  price: true,
  vatRate: true,
  boxAmount: true,
  prefLabel: true,
  prefOptions: true,
  prefDefault: true,
  extraOptions: true,
  isFresh: true,
  status: true,
  stockStatus: true,
  deletedAt: true,
  lots: { where: { isCurrent: true }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, lotCode: true } },
} satisfies Prisma.ProductSelect;
export type ProductRecord = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

export const ORDER_SUMMARY_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  grandTotal: true,
  note: true,
  addressSnapshot: true,
  paidAt: true,
  customerName: true,
  customerPhone: true,
  // F9 (ekran 20 paketleme fişi): müşteri e-postası + ops notu (telafi kayıtları burada [B19])
  customerEmail: true,
  adminNote: true,
} satisfies Prisma.OrderSelect;
export type OrderSummaryRecord = Prisma.OrderGetPayload<{ select: typeof ORDER_SUMMARY_SELECT }>;

export const CYCLE_ITEM_INCLUDE = {
  product: { select: PRODUCT_SELECT },
  lot: { select: { id: true, lotCode: true } },
} satisfies Prisma.CycleItemInclude;
export type CycleItemRecord = Prisma.CycleItemGetPayload<{ include: typeof CYCLE_ITEM_INCLUDE }>;

export const CYCLE_INCLUDE = {
  deliveryDate: true,
  items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: CYCLE_ITEM_INCLUDE },
  order: { select: ORDER_SUMMARY_SELECT },
  deltaOrder: { select: ORDER_SUMMARY_SELECT },
} satisfies Prisma.SubscriptionCycleInclude;
export type CycleRecord = Prisma.SubscriptionCycleGetPayload<{ include: typeof CYCLE_INCLUDE }>;

export const CYCLE_WITH_SUB_INCLUDE = {
  ...CYCLE_INCLUDE,
  subscription: { include: SUB_INCLUDE },
} satisfies Prisma.SubscriptionCycleInclude;
export type CycleWithSubRecord = Prisma.SubscriptionCycleGetPayload<{ include: typeof CYCLE_WITH_SUB_INCLUDE }>;

export const TEMPLATE_INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: PRODUCT_SELECT } } },
} satisfies Prisma.BoxTemplateInclude;
export type TemplateRecord = Prisma.BoxTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

export const ADDRESS_INCLUDE = { zone: { select: { id: true, name: true, slug: true } } } satisfies Prisma.AddressInclude;
export type AddressRecord = Prisma.AddressGetPayload<{ include: typeof ADDRESS_INCLUDE }>;

/** Müşteri özeti (admin manuel checkout). */
export const CUSTOMER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  anonymizedAt: true,
  deletedAt: true,
  firstBoxesPromoUsedAt: true,
} satisfies Prisma.UserSelect;
export type CustomerRecord = Prisma.UserGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export type EventRecord = Prisma.SubscriptionEventGetPayload<Record<string, never>>;
export type CancellationRecord = Prisma.SubscriptionCancellationGetPayload<Record<string, never>>;
export type DeliveryDateRecord = Prisma.DeliveryDateGetPayload<Record<string, never>>;
export type PaymentRecord = Prisma.PaymentGetPayload<Record<string, never>>;
export type OrderRecord = Prisma.OrderGetPayload<{ include: { lines: true } }>;
export type PaymentMethodRecord = Prisma.PaymentMethodGetPayload<Record<string, never>>;
export type ZoneRecord = Prisma.DeliveryZoneGetPayload<Record<string, never>>;

/** F9 ops gün özeti: teslimat tarihi + bölgesi. */
export const DELIVERY_DATE_WITH_ZONE_INCLUDE = {
  zone: { select: { id: true, slug: true, name: true, sortOrder: true } },
} satisfies Prisma.DeliveryDateInclude;
export type DeliveryDateWithZoneRecord = Prisma.DeliveryDateGetPayload<{ include: typeof DELIVERY_DATE_WITH_ZONE_INCLUDE }>;

export interface AdminSubscriptionFilter {
  status?: SubscriptionStatus;
  q?: string;
}

export interface CycleDateFilter {
  /** Takvim günü (UTC gece yarısı Date). */
  date: Date;
  status?: CycleStatus[];
  zoneId?: string;
}

export interface EventInput {
  subscriptionId: string;
  cycleId?: string | null;
  type: Prisma.SubscriptionEventCreateInput['type'];
  actor: string;
  data?: Record<string, unknown> | null;
  at: Date;
}

export interface SystemWarnInput {
  module: string;
  action: string;
  message: string;
  fingerprint: string;
  metadata?: Record<string, unknown>;
  now: Date;
}

/**
 * SubscriptionsRepository — Subscription / SubscriptionCycle / CycleItem / SubscriptionEvent / SubscriptionCancellation
 * + motorun okuduğu komşu tablolar (BoxTemplate, Product(+lot), Address, PaymentMethod, DeliveryZone/Date, Order/Payment
 * yalnız okuma — yazım OrdersService/PaymentsService/DeliveryDatesService'te, SystemLog). Prisma YALNIZ burada (ADR-0002). Zaman parametreyle gelir; ham SQL'de
 * `now()` yok, `${now}` bağlanır (ADR-0004). Satır kilitleri: `FOR UPDATE [SKIP LOCKED]` (state-machines §0/§8).
 */
@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  db(tx?: Db): Db {
    return tx ?? this.prisma;
  }

  /** Interactive transaction — servisler tek noktadan açar (zaman aşımı: sağlayıcı çağrısı içeride DEĞİL). */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
  }

  // ── Subscription ────────────────────────────────────────────────────────────

  findSubscriptionById(id: string, tx?: Db): Promise<SubscriptionRecord | null> {
    return this.db(tx).subscription.findUnique({ where: { id }, include: SUB_INCLUDE });
  }

  /** Kullanıcının verilen durumlardaki en yeni aboneliği. */
  findSubscriptionForUser(userId: string, statuses: readonly SubscriptionStatus[], tx?: Db): Promise<SubscriptionRecord | null> {
    return this.db(tx).subscription.findFirst({
      where: { userId, status: { in: [...statuses] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: SUB_INCLUDE,
    });
  }

  countSubscriptionsForUser(userId: string, statuses: readonly SubscriptionStatus[], tx?: Db): Promise<number> {
    return this.db(tx).subscription.count({ where: { userId, status: { in: [...statuses] } } });
  }

  createSubscription(data: Prisma.SubscriptionUncheckedCreateInput, tx?: Db): Promise<SubscriptionRecord> {
    return this.db(tx).subscription.create({ data, include: SUB_INCLUDE });
  }

  updateSubscription(id: string, data: Prisma.SubscriptionUncheckedUpdateInput, tx?: Db): Promise<SubscriptionRecord> {
    return this.db(tx).subscription.update({ where: { id }, data, include: SUB_INCLUDE });
  }

  /** Abonelik satırını işlem boyunca kilitler (FOR UPDATE); satır yoksa false. */
  async lockSubscription(id: string, tx: Db): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE id = ${id} FOR UPDATE`;
    return rows.length > 0;
  }

  /** Motorun işlediği abonelikler (id sıralı, imleçli sayfalama). */
  listEngineSubscriptions(
    statuses: readonly SubscriptionStatus[],
    opts: { afterId?: string; take: number; subscriptionId?: string },
    tx?: Db,
  ): Promise<SubscriptionRecord[]> {
    return this.db(tx).subscription.findMany({
      where: {
        status: { in: [...statuses] },
        isOneTime: false,
        ...(opts.subscriptionId ? { id: opts.subscriptionId } : {}),
        ...(opts.afterId ? { id: { gt: opts.afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: opts.take,
      include: SUB_INCLUDE,
    });
  }

  async adminListSubscriptions(filter: AdminSubscriptionFilter, skip: number, take: number): Promise<{ rows: SubscriptionRecord[]; total: number }> {
    const where: Prisma.SubscriptionWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { user: { email: { contains: filter.q, mode: 'insensitive' } } },
              { user: { name: { contains: filter.q, mode: 'insensitive' } } },
              { id: filter.q },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take, include: SUB_INCLUDE }),
      this.prisma.subscription.count({ where }),
    ]);
    return { rows, total };
  }

  updateUser(userId: string, data: Prisma.UserUncheckedUpdateInput, tx?: Db): Promise<{ id: string }> {
    return this.db(tx).user.update({ where: { id: userId }, data, select: { id: true } });
  }

  // ── Cycle ───────────────────────────────────────────────────────────────────

  findCyclesOfSubscription(subscriptionId: string, tx?: Db): Promise<CycleRecord[]> {
    return this.db(tx).subscriptionCycle.findMany({
      where: { subscriptionId },
      orderBy: [{ deliveryDate: { date: 'asc' } }, { cycleNo: 'asc' }],
      include: CYCLE_INCLUDE,
    });
  }

  findCycleById(id: string, tx?: Db): Promise<CycleWithSubRecord | null> {
    return this.db(tx).subscriptionCycle.findUnique({ where: { id }, include: CYCLE_WITH_SUB_INCLUDE });
  }

  findLastCycle(subscriptionId: string, tx?: Db): Promise<CycleRecord | null> {
    return this.db(tx).subscriptionCycle.findFirst({ where: { subscriptionId }, orderBy: { cycleNo: 'desc' }, include: CYCLE_INCLUDE });
  }

  createCycle(data: Prisma.SubscriptionCycleUncheckedCreateInput, tx?: Db): Promise<CycleRecord> {
    return this.db(tx).subscriptionCycle.create({ data, include: CYCLE_INCLUDE });
  }

  updateCycle(id: string, data: Prisma.SubscriptionCycleUncheckedUpdateInput, tx?: Db): Promise<CycleRecord> {
    return this.db(tx).subscriptionCycle.update({ where: { id }, data, include: CYCLE_INCLUDE });
  }

  /** Koşullu güncelleme (yarış güvenli): etkilenen satır sayısı. */
  async updateCycleWhere(where: Prisma.SubscriptionCycleWhereInput, data: Prisma.SubscriptionCycleUncheckedUpdateInput, tx?: Db): Promise<number> {
    const r = await this.db(tx).subscriptionCycle.updateMany({ where, data });
    return r.count;
  }

  async deleteCycles(ids: string[], tx?: Db): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await this.db(tx).subscriptionCycle.deleteMany({ where: { id: { in: ids } } });
    return r.count;
  }

  /** Cycle satırını kilitler (FOR UPDATE SKIP LOCKED) ve beklenen durumdaysa true döner. */
  async lockCycle(id: string, expectedStatus: CycleStatus, tx: Db): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM subscription_cycles
      WHERE id = ${id} AND status = CAST(${expectedStatus} AS "CycleStatus")
      FOR UPDATE SKIP LOCKED`;
    return rows.length > 0;
  }

  /** state-machines §8: kesimi geçmiş SCHEDULED cycle'lar (bound Date; `now()` yok). */
  async selectDueCycleIds(now: Date, limit: number, tx?: Db): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>`
      SELECT c.id FROM subscription_cycles c
      JOIN delivery_dates d ON d.id = c."deliveryDateId"
      WHERE c.status = 'SCHEDULED' AND d."cutoffAt" <= ${now}
      ORDER BY d."cutoffAt" ASC, c.id ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** Kilitlenmiş ama tahsilata geçememiş (çökme sonrası) cycle'lar: LOCKED ve lockedAt eski. */
  async selectStrandedLockedCycleIds(olderThan: Date, limit: number, tx?: Db): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>`
      SELECT id FROM subscription_cycles
      WHERE status = 'LOCKED' AND "lockedAt" IS NOT NULL AND "lockedAt" <= ${olderThan}
      ORDER BY "lockedAt" ASC, id ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** state-machines §9: UNPAID ve nextRetryAt geçmiş. */
  async selectRetryCycleIds(now: Date, limit: number, tx?: Db): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>`
      SELECT id FROM subscription_cycles
      WHERE status = 'UNPAID' AND "nextRetryAt" IS NOT NULL AND "nextRetryAt" <= ${now}
      ORDER BY "nextRetryAt" ASC, id ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** AWAITING_PAYMENT ve paymentDueAt geçmiş. */
  async selectExpiredLinkCycleIds(now: Date, limit: number, tx?: Db): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>`
      SELECT id FROM subscription_cycles
      WHERE status = 'AWAITING_PAYMENT' AND "paymentDueAt" IS NOT NULL AND "paymentDueAt" <= ${now}
      ORDER BY "paymentDueAt" ASC, id ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** Belirli güne ait cycle'lar (admin liste + ops pick/packing). */
  findCyclesForDate(filter: CycleDateFilter, tx?: Db): Promise<CycleWithSubRecord[]> {
    return this.db(tx).subscriptionCycle.findMany({
      where: {
        deliveryDate: { date: filter.date, ...(filter.zoneId ? { zoneId: filter.zoneId } : {}) },
        ...(filter.status && filter.status.length > 0 ? { status: { in: filter.status } } : {}),
      },
      orderBy: [{ subscription: { zoneId: 'asc' } }, { id: 'asc' }],
      include: CYCLE_WITH_SUB_INCLUDE,
    });
  }

  /** Kesim hatırlatması penceresi: SCHEDULED, cutoffAt ∈ (from, to]. */
  findReminderCycles(from: Date, to: Date, tx?: Db): Promise<CycleWithSubRecord[]> {
    return this.db(tx).subscriptionCycle.findMany({
      where: { status: 'SCHEDULED', deliveryDate: { cutoffAt: { gt: from, lte: to } } },
      include: CYCLE_WITH_SUB_INCLUDE,
    });
  }

  // ── CycleItem ───────────────────────────────────────────────────────────────

  async createCycleItems(data: Prisma.CycleItemUncheckedCreateInput[], tx?: Db): Promise<number> {
    if (data.length === 0) return 0;
    const r = await this.db(tx).cycleItem.createMany({ data });
    return r.count;
  }

  async deleteCycleItems(where: Prisma.CycleItemWhereInput, tx?: Db): Promise<number> {
    const r = await this.db(tx).cycleItem.deleteMany({ where });
    return r.count;
  }

  updateCycleItem(id: string, data: Prisma.CycleItemUncheckedUpdateInput, tx?: Db): Promise<{ id: string }> {
    return this.db(tx).cycleItem.update({ where: { id }, data, select: { id: true } });
  }

  // ── SubscriptionEvent / SubscriptionCancellation ────────────────────────────

  addEvent(input: EventInput, tx?: Db): Promise<EventRecord> {
    return this.db(tx).subscriptionEvent.create({
      data: {
        subscriptionId: input.subscriptionId,
        cycleId: input.cycleId ?? null,
        type: input.type,
        actor: input.actor,
        data: input.data === undefined || input.data === null ? Prisma.JsonNull : (input.data as Prisma.InputJsonValue),
        createdAt: input.at,
      },
    });
  }

  findEvents(subscriptionId: string, take = 200, tx?: Db): Promise<EventRecord[]> {
    return this.db(tx).subscriptionEvent.findMany({ where: { subscriptionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take });
  }

  createCancellation(data: Prisma.SubscriptionCancellationUncheckedCreateInput, tx?: Db): Promise<CancellationRecord> {
    return this.db(tx).subscriptionCancellation.create({ data });
  }

  updateCancellation(id: string, data: Prisma.SubscriptionCancellationUncheckedUpdateInput, tx?: Db): Promise<CancellationRecord> {
    return this.db(tx).subscriptionCancellation.update({ where: { id }, data });
  }

  findOpenCancellation(subscriptionId: string, tx?: Db): Promise<CancellationRecord | null> {
    return this.db(tx).subscriptionCancellation.findFirst({ where: { subscriptionId, outcome: 'PENDING' }, orderBy: { requestedAt: 'desc' } });
  }

  findCancellations(subscriptionId: string, tx?: Db): Promise<CancellationRecord[]> {
    return this.db(tx).subscriptionCancellation.findMany({ where: { subscriptionId }, orderBy: { requestedAt: 'desc' } });
  }

  // ── Katalog: şablon / ürün / tier ───────────────────────────────────────────

  /** Tier × hafta başı için YAYINLANMIŞ şablon (ADR-0008: içerik tek kaynağı). */
  findPublishedTemplate(tierId: string, weekStart: Date, tx?: Db): Promise<TemplateRecord | null> {
    return this.db(tx).boxTemplate.findFirst({ where: { tierId, weekStart, status: 'PUBLISHED' }, include: TEMPLATE_INCLUDE });
  }

  findTemplateCurator(tierId: string, weekStart: Date, tx?: Db): Promise<string | null> {
    return this.db(tx).boxTemplate
      .findFirst({ where: { tierId, weekStart }, select: { curatorName: true } })
      .then((r) => r?.curatorName ?? null);
  }

  findProductsBySlugs(slugs: string[], tx?: Db): Promise<ProductRecord[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db(tx).product.findMany({ where: { slug: { in: slugs } }, select: PRODUCT_SELECT });
  }

  findProductById(id: string, tx?: Db): Promise<ProductRecord | null> {
    return this.db(tx).product.findUnique({ where: { id }, select: PRODUCT_SELECT });
  }

  findTierBySlug(slug: string, tx?: Db) {
    return this.db(tx).boxTier.findUnique({ where: { slug } });
  }

  findTierById(id: string, tx?: Db) {
    return this.db(tx).boxTier.findUnique({ where: { id } });
  }

  // ── Adres / kart / bölge ────────────────────────────────────────────────────

  findAddressForUser(addressId: string, userId: string, tx?: Db): Promise<AddressRecord | null> {
    return this.db(tx).address.findFirst({ where: { id: addressId, userId, deletedAt: null }, include: ADDRESS_INCLUDE });
  }

  /** Kullanıcının varsayılan (aktif) adresi — admin manuel checkout `addressId` vermezse. */
  findDefaultAddressForUser(userId: string, tx?: Db): Promise<AddressRecord | null> {
    return this.db(tx).address.findFirst({ where: { userId, deletedAt: null, isDefault: true }, orderBy: { createdAt: 'desc' }, include: ADDRESS_INCLUDE });
  }

  /** Müşteri özeti (admin manuel checkout: müşteri snapshot'ı + hak kontrolü). */
  findUserById(id: string, tx?: Db): Promise<CustomerRecord | null> {
    return this.db(tx).user.findUnique({ where: { id }, select: CUSTOMER_SELECT });
  }

  findPaymentMethodForUser(id: string, userId: string, tx?: Db): Promise<PaymentMethodRecord | null> {
    return this.db(tx).paymentMethod.findFirst({ where: { id, userId, isActive: true, deletedAt: null } });
  }

  findZoneBySlug(slug: string, tx?: Db): Promise<ZoneRecord | null> {
    return this.db(tx).deliveryZone.findUnique({ where: { slug } });
  }

  // ── DeliveryDate (yalnız okuma; rezerv/iade/üretim DeliveryDatesService — SubscriptionsDepsAdapter) ─────────────

  findDeliveryDateById(id: string, tx?: Db): Promise<DeliveryDateRecord | null> {
    return this.db(tx).deliveryDate.findUnique({ where: { id } });
  }

  /** F9 ops gün özeti: takvim gününün (isteğe bağlı bölge süzgeci) teslimat tarihi satırları + bölge bilgisi. */
  findDeliveryDatesForDate(date: Date, zoneId?: string, tx?: Db): Promise<DeliveryDateWithZoneRecord[]> {
    return this.db(tx).deliveryDate.findMany({
      where: { date, ...(zoneId ? { zoneId } : {}) },
      orderBy: [{ zone: { sortOrder: 'asc' } }, { zone: { slug: 'asc' } }],
      include: DELIVERY_DATE_WITH_ZONE_INCLUDE,
    });
  }

  /**
   * F9 ops gün özeti: aynı teslimat gününün ABONELİK DIŞI (tekil ürün) siparişleri — ödemesi alınmış durumlar.
   * Kutu siparişleri cycle üzerinden sayıldığından `subscriptionId: null` şartı çift saymayı önler.
   */
  findStandaloneOrdersForDate(date: Date, zoneId: string | undefined, statuses: readonly OrderStatusEnum[], tx?: Db) {
    return this.db(tx).order.findMany({
      where: { deliveryOn: date, subscriptionId: null, deletedAt: null, status: { in: [...statuses] }, ...(zoneId ? { zoneId } : {}) },
      select: { id: true, orderNo: true, status: true, grandTotal: true, zoneId: true },
    });
  }

  // ── Order / Payment (yalnız okuma — yazım OrdersService / PaymentsService üzerinden, SubscriptionsDepsAdapter) ──────

  findOrderById(id: string, tx?: Db): Promise<OrderRecord | null> {
    return this.db(tx).order.findUnique({ where: { id }, include: { lines: true } });
  }

  /** Siparişin açık (PENDING/REQUIRES_3DS) LINK ödemeleri. */
  findOpenLinkPayments(orderId: string, tx?: Db): Promise<PaymentRecord[]> {
    return this.db(tx).payment.findMany({ where: { orderId, kind: 'LINK', status: { in: ['PENDING', 'REQUIRES_3DS'] } } });
  }

  findPaymentsOfOrder(orderId: string, tx?: Db): Promise<PaymentRecord[]> {
    return this.db(tx).payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  /** Süresi dolmuş açık LINK ödemeleri (cycle UNPAID iken yeniden gönderilen linkler dahil) → EXPIRED. */
  async expireStaleLinkPayments(now: Date, tx?: Db): Promise<number> {
    const r = await this.db(tx).payment.updateMany({
      where: { kind: 'LINK', status: { in: ['PENDING', 'REQUIRES_3DS'] }, linkExpiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return r.count;
  }

  // ── SystemLog (ops uyarısı, günde 1 digest) ─────────────────────────────────

  async upsertSystemWarning(input: SystemWarnInput, tx?: Db): Promise<void> {
    const db = this.db(tx);
    const existing = await db.systemLog.findFirst({
      where: { fingerprint: input.fingerprint, lastSeenAt: { gte: new Date(input.now.getTime() - SYSTEM_WARN_DIGEST_MS) } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await db.systemLog.update({ where: { id: existing.id }, data: { occurrenceCount: { increment: 1 }, lastSeenAt: input.now, message: input.message } });
      return;
    }
    await db.systemLog.create({
      data: {
        level: 'WARN',
        module: input.module,
        action: input.action,
        message: input.message,
        fingerprint: input.fingerprint,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
        createdAt: input.now,
      },
    });
  }
}
