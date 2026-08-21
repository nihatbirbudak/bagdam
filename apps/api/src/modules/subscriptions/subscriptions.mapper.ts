import {
  CYCLE_FULFILLABLE_STATES,
  CYCLE_IN_FLIGHT_STATES,
  deliveryDayToSlug,
  freqIdFromWeeks,
  roundMoney,
  utcToIsoDate,
  type AdminCycleListItem,
  type BootstrapSub,
  type CancelOutcome,
  type CancelReason,
  type ChargeStrategy,
  type ClientCycleSummary,
  type CycleItem,
  type CycleItemSource,
  type CycleStatus,
  type DeliveryDay,
  type IsoDate,
  type Money,
  type OpsDaySummary,
  type PackingListEntry,
  type PackingListItem,
  type PickListRow,
  type SkipSource,
  type SubEventType,
  type Subscription,
  type SubscriptionCancellation,
  type SubscriptionCycle,
  type SubscriptionEvent,
  type SubscriptionListItem,
  type SubscriptionStatus,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import type {
  CancellationRecord,
  CycleItemRecord,
  CycleRecord,
  CycleWithSubRecord,
  DeliveryDateWithZoneRecord,
  EventRecord,
  SubscriptionRecord,
} from './subscriptions.repository';

// ── Para ──────────────────────────────────────────────────────────────────────

/** Prisma Decimal(12,2) → number (TL). */
export function money(value: Prisma.Decimal | number): Money {
  return typeof value === 'number' ? value : Number(value.toString());
}
export function moneyOrNull(value: Prisma.Decimal | null | undefined): Money | null {
  return value === null || value === undefined ? null : money(value);
}
/** number → Prisma Decimal (kuruş). */
export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}
/** Miktar/çarpan Decimal(8,3). */
export function toQtyDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(3));
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ── Cycle seçiciler (BootstrapSub / müşteri uçları) ─────────────────────────────

export const BOX_SOURCES: readonly CycleItemSource[] = ['TEMPLATE', 'SWAP'];
export const EXTRA_SOURCES: readonly CycleItemSource[] = ['EXTRA', 'CART_MERGE'];

export function isBoxItem(item: Pick<CycleItemRecord, 'source'>): boolean {
  return BOX_SOURCES.includes(item.source);
}
export function isExtraItem(item: Pick<CycleItemRecord, 'source'>): boolean {
  return EXTRA_SOURCES.includes(item.source);
}

/** Düzenlenebilir (SCHEDULED/SKIPPED, kesimi geçmemiş) en yakın cycle — liste teslimat tarihine göre sıralı gelir. */
export function pickCurrentCycle(cycles: readonly CycleRecord[], now: Date): CycleRecord | null {
  return cycles.find((c) => (c.status === 'SCHEDULED' || c.status === 'SKIPPED') && c.deliveryDate.cutoffAt.getTime() > now.getTime()) ?? null;
}

/** Kilitlenmiş ve teslim edilmemiş en yakın cycle. */
export function pickInFlightCycle(cycles: readonly CycleRecord[]): CycleRecord | null {
  return cycles.find((c) => (CYCLE_IN_FLIGHT_STATES as readonly string[]).includes(c.status)) ?? null;
}

// ── DTO'lar ───────────────────────────────────────────────────────────────────

export function toCycleItemDto(item: CycleItemRecord): CycleItem {
  return {
    id: item.id,
    cycleId: item.cycleId,
    source: item.source as CycleItemSource,
    productId: item.productId,
    productSlug: item.product.slug,
    productName: item.product.name,
    lotId: item.lotId,
    swapOfProductId: item.swapOfProductId,
    pref: item.pref,
    qty: Number(item.qty.toString()),
    unit: item.unit,
    label: item.label,
    unitPrice: moneyOrNull(item.unitPrice),
    lotCode: item.lotCode,
    sortOrder: item.sortOrder,
  };
}

export function toCycleDto(cycle: CycleRecord): SubscriptionCycle {
  return {
    id: cycle.id,
    subscriptionId: cycle.subscriptionId,
    cycleNo: cycle.cycleNo,
    deliveryDateId: cycle.deliveryDateId,
    deliveryOn: utcToIsoDate(cycle.deliveryDate.date),
    cutoffAt: cycle.deliveryDate.cutoffAt.toISOString(),
    status: cycle.status as CycleStatus,
    skipSource: (cycle.skipSource as SkipSource | null) ?? null,
    boxPrice: moneyOrNull(cycle.boxPrice),
    extrasTotal: moneyOrNull(cycle.extrasTotal),
    discount: moneyOrNull(cycle.discount),
    shippingFee: moneyOrNull(cycle.shippingFee),
    total: moneyOrNull(cycle.total),
    prepaidAmount: money(cycle.prepaidAmount),
    orderId: cycle.orderId,
    deltaOrderId: cycle.deltaOrderId,
    lockedAt: iso(cycle.lockedAt),
    skippedAt: iso(cycle.skippedAt),
    paymentDueAt: iso(cycle.paymentDueAt),
    retryCount: cycle.retryCount,
    nextRetryAt: iso(cycle.nextRetryAt),
    items: cycle.items.map(toCycleItemDto),
  };
}

export function toEventDto(e: EventRecord): SubscriptionEvent {
  return {
    id: e.id,
    subscriptionId: e.subscriptionId,
    cycleId: e.cycleId,
    type: e.type as SubEventType,
    actor: e.actor,
    data: (e.data as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toCancellationDto(c: CancellationRecord): SubscriptionCancellation {
  return {
    id: c.id,
    subscriptionId: c.subscriptionId,
    reason: (c.reason as CancelReason | null) ?? null,
    reasonText: c.reasonText,
    retentionOffered: c.retentionOffered,
    outcome: c.outcome as CancelOutcome,
    requestedAt: c.requestedAt.toISOString(),
    effectiveAt: iso(c.effectiveAt),
    confirmedAt: iso(c.confirmedAt),
    refundAmount: moneyOrNull(c.refundAmount),
    refundDueAt: iso(c.refundDueAt),
  };
}

export interface SubscriptionDtoExtras {
  cycles?: CycleRecord[];
  cancellations?: CancellationRecord[];
  events?: EventRecord[];
}

export function toSubscriptionDto(sub: SubscriptionRecord, extras: SubscriptionDtoExtras = {}): Subscription {
  return {
    id: sub.id,
    userId: sub.userId,
    userEmail: sub.user.email,
    userName: sub.user.name,
    tierId: sub.tierId,
    tierSlug: sub.tier.slug,
    tierLabel: sub.tier.label,
    isOneTime: sub.isOneTime,
    status: sub.status as SubscriptionStatus,
    frequencyWeeks: sub.frequencyWeeks,
    deliveryDay: sub.deliveryDay as DeliveryDay,
    zoneId: sub.zoneId,
    addressId: sub.addressId,
    paymentMethodId: sub.paymentMethodId,
    itemPrefs: (sub.itemPrefs as Record<string, string> | null) ?? {},
    chargeStrategy: sub.chargeStrategy as ChargeStrategy,
    discountBoxesLeft: sub.discountBoxesLeft,
    nextBoxDiscountPct: sub.nextBoxDiscountPct,
    skipsUsed: sub.skipsUsed,
    skipsResetAt: iso(sub.skipsResetAt),
    failedCycles: sub.failedCycles,
    contractDocId: sub.contractDocId,
    startedAt: iso(sub.startedAt),
    nextDeliveryOn: sub.nextDeliveryOn ? utcToIsoDate(sub.nextDeliveryOn) : null,
    nextCutoffAt: iso(sub.nextCutoffAt),
    cancelRequestedAt: iso(sub.cancelRequestedAt),
    cancelledAt: iso(sub.cancelledAt),
    completedAt: iso(sub.completedAt),
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    ...(extras.cycles ? { cycles: extras.cycles.map(toCycleDto) } : {}),
    ...(extras.cancellations ? { cancellations: extras.cancellations.map(toCancellationDto) } : {}),
    ...(extras.events ? { events: extras.events.map(toEventDto) } : {}),
  };
}

export function toSubscriptionListItem(sub: SubscriptionRecord): SubscriptionListItem {
  return {
    id: sub.id,
    userEmail: sub.user.email,
    userName: sub.user.name,
    tierSlug: sub.tier.slug,
    isOneTime: sub.isOneTime,
    status: sub.status as SubscriptionStatus,
    frequencyWeeks: sub.frequencyWeeks,
    deliveryDay: sub.deliveryDay as DeliveryDay,
    zoneName: sub.zone.name,
    nextDeliveryOn: sub.nextDeliveryOn ? utcToIsoDate(sub.nextDeliveryOn) : null,
    failedCycles: sub.failedCycles,
    startedAt: iso(sub.startedAt),
  };
}

export function toAdminCycleListItem(cycle: CycleWithSubRecord): AdminCycleListItem {
  const sub = cycle.subscription;
  return {
    ...toCycleDto(cycle),
    userEmail: sub.user.email,
    userName: sub.user.name,
    tierSlug: sub.tier.slug,
    zoneName: sub.zone.name,
    isOneTime: sub.isOneTime,
    subscriptionStatus: sub.status as SubscriptionStatus,
    orderNo: cycle.order?.orderNo ?? null,
    orderStatus: cycle.order?.status ?? null,
    deltaOrderNo: cycle.deltaOrder?.orderNo ?? null,
  };
}

// ── Müşteri (cart.js `sub`) DTO'su ─────────────────────────────────────────────

export interface ClientCycleSummaryInput {
  cycle: CycleRecord;
  now: Date;
  /** SCHEDULED iken canlı quote; kilitliyse snapshot kullanılır. */
  liveTotal?: Money | null;
  paymentLinkUrl?: string | null;
}

export function toClientCycleSummary({ cycle, now, liveTotal = null, paymentLinkUrl = null }: ClientCycleSummaryInput): ClientCycleSummary {
  const locked = cycle.deliveryDate.cutoffAt.getTime() <= now.getTime() || cycle.status !== 'SCHEDULED';
  return {
    id: cycle.id,
    cycleNo: cycle.cycleNo,
    status: cycle.status as CycleStatus,
    skipSource: (cycle.skipSource as SkipSource | null) ?? null,
    deliveryOn: utcToIsoDate(cycle.deliveryDate.date),
    deliveryDay: deliveryDayToSlug(cycle.deliveryDate.day as DeliveryDay),
    cutoffAtIso: cycle.deliveryDate.cutoffAt.toISOString(),
    locked,
    total: cycle.total !== null ? money(cycle.total) : liveTotal,
    prepaidAmount: money(cycle.prepaidAmount),
    paymentLinkUrl: cycle.status === 'AWAITING_PAYMENT' ? paymentLinkUrl : null,
    paymentDueAtIso: iso(cycle.paymentDueAt),
  };
}

export interface BootstrapSubInput {
  sub: SubscriptionRecord;
  cycles: readonly CycleRecord[];
  openCancellation: CancellationRecord | null;
  now: Date;
  skipsPerYear: number;
  /** current cycle SCHEDULED iken canlı toplam. */
  liveTotal: Money | null;
  /** inFlight AWAITING_PAYMENT ise ödeme linki. */
  paymentLinkUrl: string | null;
}

/** Subscription + cycle'lar → `GET /me/subscription` / bootstrap `sub` (shared BootstrapSub sözleşmesi). */
export function toBootstrapSub(input: BootstrapSubInput): BootstrapSub {
  const { sub, cycles, now } = input;
  const current = pickCurrentCycle(cycles, now);
  const inFlight = pickInFlightCycle(cycles);
  const base = current ?? inFlight;
  const boxItems = base ? base.items.filter(isBoxItem) : [];
  const extraItems = base ? base.items.filter(isExtraItem) : [];
  const unpaid = cycles.find((c) => c.status === 'UNPAID') ?? null;
  const dunning =
    unpaid !== null
      ? { active: true, retryCount: unpaid.retryCount, nextRetryAtIso: iso(unpaid.nextRetryAt) }
      : sub.status === 'PAST_DUE'
        ? { active: true, retryCount: 0, nextRetryAtIso: null }
        : null;
  return {
    tierId: sub.tier.slug,
    items: boxItems.map((i) => i.product.slug),
    skipThisWeek: current?.status === 'SKIPPED' && current.skipSource === 'USER',
    skipUsed: sub.skipsUsed >= input.skipsPerYear,
    freq: freqIdFromWeeks(sub.frequencyWeeks),
    deliveryDay: deliveryDayToSlug(sub.deliveryDay as DeliveryDay),
    type: sub.isOneTime ? 'onetime' : 'subscription',
    itemPrefs: (sub.itemPrefs as Record<string, string> | null) ?? {},
    extras: extraItems.map((i) => ({ id: i.product.slug, factor: Number(i.qty.toString()), label: i.label ?? '' })),
    extrasCutoff: current ? current.deliveryDate.cutoffAt.getTime() : null,
    purchased: true,
    active: false,
    nextBoxDiscount: sub.nextBoxDiscountPct !== null,
    id: sub.id,
    status: sub.status as SubscriptionStatus,
    isOneTime: sub.isOneTime,
    currentCycle: current ? toClientCycleSummary({ cycle: current, now, liveTotal: input.liveTotal }) : null,
    inFlightCycle: inFlight ? toClientCycleSummary({ cycle: inFlight, now, paymentLinkUrl: input.paymentLinkUrl }) : null,
    nextDeliveryOn: sub.nextDeliveryOn ? utcToIsoDate(sub.nextDeliveryOn) : null,
    nextCutoffAtIso: iso(sub.nextCutoffAt),
    dunning,
    cancellation: input.openCancellation
      ? {
          id: input.openCancellation.id,
          outcome: input.openCancellation.outcome as CancelOutcome,
          retentionOffered: input.openCancellation.retentionOffered,
          effectiveAtIso: iso(input.openCancellation.effectiveAt),
        }
      : null,
    discountBoxesLeft: sub.discountBoxesLeft,
    card: sub.paymentMethod ? { last4: sub.paymentMethod.last4, brand: sub.paymentMethod.brand } : null,
  };
}

// ── Ops listeleri ─────────────────────────────────────────────────────────────

export function buildPickList(cycles: readonly CycleWithSubRecord[]): PickListRow[] {
  const rows = new Map<string, PickListRow>();
  /** Satır anahtarı → tercih → {qty,count} (PickListRow.prefs sonda diziye çevrilir). */
  const prefs = new Map<string, Map<string, { qty: number; count: number }>>();
  for (const cycle of cycles) {
    for (const item of cycle.items) {
      const key = `${item.productId}|${item.lotCode ?? item.lot?.lotCode ?? ''}`;
      const row =
        rows.get(key) ??
        ({
          productId: item.productId,
          productSlug: item.product.slug,
          productName: item.product.name,
          unit: item.unit ?? item.product.unit,
          lotCode: item.lotCode ?? item.lot?.lotCode ?? null,
          totalQty: 0,
          boxCount: 0,
          extraCount: 0,
          boxQty: 0,
          extraQty: 0,
          labels: [],
          prefs: [],
        } satisfies PickListRow);
      const qty = Number(item.qty.toString());
      row.totalQty = round3(row.totalQty + qty);
      if (isBoxItem(item)) {
        row.boxCount += 1;
        row.boxQty = round3(row.boxQty + qty);
      } else {
        row.extraCount += 1;
        row.extraQty = round3(row.extraQty + qty);
      }
      const label = item.label ?? item.product.boxAmount ?? null;
      if (label && !row.labels.includes(label)) row.labels.push(label);
      if (item.pref) {
        const byPref = prefs.get(key) ?? new Map<string, { qty: number; count: number }>();
        const hit = byPref.get(item.pref) ?? { qty: 0, count: 0 };
        hit.qty = round3(hit.qty + qty);
        hit.count += 1;
        byPref.set(item.pref, hit);
        prefs.set(key, byPref);
      }
      rows.set(key, row);
    }
  }
  for (const [key, row] of rows) {
    const byPref = prefs.get(key);
    if (byPref) row.prefs = [...byPref.entries()].map(([pref, v]) => ({ pref, qty: v.qty, count: v.count })).sort((a, b) => a.pref.localeCompare(b.pref, 'tr'));
  }
  return [...rows.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'tr'));
}

/** Decimal(8,3) toplamlarında kayan nokta artığını temizler. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildPackingList(cycles: readonly CycleWithSubRecord[], curatorByTier: ReadonlyMap<string, string | null>): PackingListEntry[] {
  return cycles.map((cycle) => {
    const sub = cycle.subscription;
    const snapshot = (cycle.order?.addressSnapshot as { fullName?: string; phone?: string; line?: string; zoneName?: string; zip?: string | null } | null) ?? null;
    const items: PackingListItem[] = cycle.items.map((i) => ({
      productId: i.productId,
      productSlug: i.product.slug,
      name: i.product.name,
      label: i.label ?? i.product.boxAmount ?? null,
      pref: i.pref,
      source: i.source as CycleItemSource,
      lotCode: i.lotCode ?? i.lot?.lotCode ?? null,
      qty: Number(i.qty.toString()),
      unit: i.unit ?? i.product.unit,
    }));
    return {
      cycleId: cycle.id,
      subscriptionId: sub.id,
      orderNo: cycle.order?.orderNo ?? null,
      customerName: cycle.order?.customerName ?? snapshot?.fullName ?? sub.address?.fullName ?? sub.user.name ?? sub.user.email,
      customerPhone: cycle.order?.customerPhone ?? snapshot?.phone ?? sub.address?.phone ?? sub.user.phone ?? '',
      addressLine: snapshot?.line ?? sub.address?.line ?? '',
      zoneName: snapshot?.zoneName ?? sub.zone.name,
      tierSlug: sub.tier.slug,
      tierLabel: sub.tier.label,
      curatorName: curatorByTier.get(sub.tierId) ?? null,
      status: cycle.status as CycleStatus,
      items,
      note: cycle.order?.note ?? null,
      // F9 ekleri (ekran 20)
      cycleNo: cycle.cycleNo,
      isOneTime: sub.isOneTime,
      deliveryOn: utcToIsoDate(cycle.deliveryDate.date),
      deliveryDay: deliveryDayToSlug(cycle.deliveryDate.day as DeliveryDay),
      zoneSlug: sub.zone.slug,
      customerEmail: cycle.order?.customerEmail ?? sub.user.email,
      addressZip: snapshot?.zip ?? sub.address?.zip ?? null,
      itemPrefs: (sub.itemPrefs as Record<string, string> | null) ?? {},
      orderStatus: cycle.order?.status ?? null,
      adminNote: cycle.order?.adminNote ?? null,
      total: moneyOrNull(cycle.total),
      boxItemCount: items.filter((i) => (BOX_SOURCES as readonly string[]).includes(i.source)).length,
      extraItemCount: items.filter((i) => (EXTRA_SOURCES as readonly string[]).includes(i.source)).length,
    };
  });
}

// ── Ops gün özeti (F9 ekran 20/21) ────────────────────────────────────────────

/** `buildDaySummary` girdisi — servis DB'den toplar, mapper yalnız sayar (saf fonksiyon: TZ'siz, `now` dışarıdan). */
export interface DaySummaryInput {
  date: IsoDate;
  zoneSlug: string | null;
  now: Date;
  cycles: readonly CycleWithSubRecord[];
  deliveryDates: readonly DeliveryDateWithZoneRecord[];
  standaloneOrders: ReadonlyArray<{ id: string; grandTotal: Prisma.Decimal; zoneId: string | null }>;
}

/**
 * Günün ops özeti: cycle durum dağılımı, teslimata girecek kutular (tier kırılımı + satır sayıları), ciro,
 * bölge bazlı kapasite/kesim durumu ve abonelik dışı sipariş sayısı. Ciro cycle'ın ana + delta siparişinden.
 */
export function buildDaySummary(input: DaySummaryInput): OpsDaySummary {
  const { cycles, deliveryDates, standaloneOrders, now } = input;
  const fulfillable = (status: string): boolean => (CYCLE_FULFILLABLE_STATES as readonly string[]).includes(status);

  const cycleCountsByStatus: Partial<Record<CycleStatus, number>> = {};
  const byTier = new Map<string, { tierSlug: string; tierLabel: string; count: number }>();
  const cycleCountByZone = new Map<string, { total: number; fulfillable: number }>();
  let fulfillableCount = 0;
  let deliveredCount = 0;
  let skippedCount = 0;
  let unpaidCount = 0;
  let awaitingPaymentCount = 0;
  let boxItemCount = 0;
  let extraItemCount = 0;
  let revenue = 0;

  for (const cycle of cycles) {
    const status = cycle.status as CycleStatus;
    cycleCountsByStatus[status] = (cycleCountsByStatus[status] ?? 0) + 1;
    const zoneKey = cycle.subscription.zoneId;
    const zoneHit = cycleCountByZone.get(zoneKey) ?? { total: 0, fulfillable: 0 };
    zoneHit.total += 1;
    if (status === 'DELIVERED') deliveredCount += 1;
    if (status === 'SKIPPED') skippedCount += 1;
    if (status === 'UNPAID') unpaidCount += 1;
    if (status === 'AWAITING_PAYMENT') awaitingPaymentCount += 1;
    if (fulfillable(status)) {
      fulfillableCount += 1;
      zoneHit.fulfillable += 1;
      const tier = byTier.get(cycle.subscription.tierId) ?? { tierSlug: cycle.subscription.tier.slug, tierLabel: cycle.subscription.tier.label, count: 0 };
      tier.count += 1;
      byTier.set(cycle.subscription.tierId, tier);
      for (const item of cycle.items) {
        if (isBoxItem(item)) boxItemCount += 1;
        else extraItemCount += 1;
      }
      revenue += money(cycle.order?.grandTotal ?? 0) + money(cycle.deltaOrder?.grandTotal ?? 0);
    }
    cycleCountByZone.set(zoneKey, zoneHit);
  }

  const zones = deliveryDates.map((dd) => {
    const counts = cycleCountByZone.get(dd.zoneId) ?? { total: 0, fulfillable: 0 };
    return {
      zoneId: dd.zoneId,
      zoneSlug: dd.zone.slug,
      zoneName: dd.zone.name,
      deliveryDateId: dd.id,
      cutoffAtIso: dd.cutoffAt.toISOString(),
      locked: dd.cutoffAt.getTime() <= now.getTime() || dd.status !== 'OPEN',
      status: dd.status as string,
      capacity: dd.capacity,
      reserved: dd.reserved,
      cycleCount: counts.total,
      fulfillableCount: counts.fulfillable,
    };
  });

  return {
    date: input.date,
    zone: input.zoneSlug,
    serverNowIso: now.toISOString(),
    cycleCountsByStatus,
    cycleCount: cycles.length,
    fulfillableCount,
    deliveredCount,
    skippedCount,
    unpaidCount,
    awaitingPaymentCount,
    boxCountByTier: [...byTier.values()].sort((a, b) => a.tierSlug.localeCompare(b.tierSlug, 'tr')),
    boxItemCount,
    extraItemCount,
    revenue: roundMoney(revenue),
    standaloneOrderCount: standaloneOrders.length,
    standaloneOrderRevenue: roundMoney(standaloneOrders.reduce((sum, o) => sum + money(o.grandTotal), 0)),
    zones,
  };
}
